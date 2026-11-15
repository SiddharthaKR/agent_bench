import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lineDiff } from "../src/diff.ts";
import { createSession } from "../src/session.ts";
import type { SessionEvent } from "../src/shared/api.ts";
import type { Session } from "../src/shared/engine.ts";
import type { Exec } from "../src/types.ts";

function fakeModel(replies: string[]) {
	const requests: { messages: { role: string; content: string }[] }[] = [];
	const fetchFn = (async (_url: unknown, init?: { body?: unknown }) => {
		requests.push(JSON.parse(String(init?.body)));
		const content = replies[requests.length - 1] ?? "Done.";
		return new Response(JSON.stringify({ choices: [{ message: { content, reasoning: "thinking it over" }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 5 } }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;
	return { fetchFn, requests };
}

const okExec: Exec = async () => ({ code: 0, stdout: "", stderr: "", timedOut: false, notFound: false });

/** Resolves when an event matching the test arrives (or already has). */
function until(session: Session, test: (event: SessionEvent) => boolean): Promise<SessionEvent> {
	return new Promise((resolve) => {
		const seen = session.events.find(test);
		if (seen) return resolve(seen);
		const off = session.subscribe((event) => {
			if (!test(event)) return;
			off();
			resolve(event);
		});
	});
}

const idleAfterWork = (session: Session) => {
	let worked = false;
	return until(session, (e) => {
		if (e.type !== "status") return false;
		if (e.state !== "idle") worked = true;
		return worked && e.state === "idle";
	});
};

it("emits and traces MCP startup problems as bad notes", async () => {
	await writeFile(path.join(root, "agents", "fpga", "agent.json"), JSON.stringify({ name: "MCP", tools: [], mcp: [{ name: "docs", command: "missing-mcp-command-123", args: [], enabled: true }] }));
	const session = await open(fakeModel(["Done."]), true);
	expect(session.events).toContainEqual(expect.objectContaining({ type: "note", tone: "bad", text: expect.stringContaining('MCP server "docs" could not start:') }));
}, 30_000);

let root: string;
let workspace: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "agentbench-session-"));
	workspace = path.join(root, "work");
	await mkdir(path.join(root, "agents", "fpga"), { recursive: true });
	await mkdir(workspace, { recursive: true });
	await writeFile(path.join(root, "agents", "fpga", "agent.json"), JSON.stringify({ name: "FPGA agent", tools: ["read_file", "write_file", "replace_lines", "compile", "run_sim"] }));
	await writeFile(path.join(root, "agents", "fpga", "prompt.md"), "You are an FPGA engineer.\n");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function open(model: ReturnType<typeof fakeModel>, askFirst: boolean, exec: Exec = okExec) {
	return createSession({
		id: "s1",
		agentDir: path.join(root, "agents", "fpga"),
		workspace,
		server: { baseUrl: "http://fake/v1", model: "fake" },
		commands: { compile: ["iverilog"], simulate: ["vvp"] },
		runsDir: path.join(root, "runs"),
		askFirst,
		exec,
		fetchFn: model.fetchFn,
	});
}

const WRITE = "I will create the file.\n@tool write_file\npath: a.v\n---\nmodule a;\nendmodule\n@end";

describe("session", () => {
	it.each([true, false])("never proposes a protected edit (ask first: %s)", async (askFirst) => {
		await writeFile(path.join(workspace, "a.v"), "given\n");
		const model = fakeModel([WRITE, "Done."]);
		const session = await createSession({ id: "protected", agentDir: path.join(root, "agents", "fpga"), workspace, server: { baseUrl: "http://fake/v1", model: "fake" }, commands: { compile: [], simulate: [] }, runsDir: path.join(root, "runs"), askFirst, protect: ["a.v"], fetchFn: model.fetchFn });
		const done = idleAfterWork(session);
		session.send("Work");
		await done;
		expect(session.events.some((event) => event.type === "proposal")).toBe(false);
		expect(model.requests[1]!.messages.at(-1)!.content).toContain("a.v is given and must not be changed.");
		expect(await readFile(path.join(workspace, "a.v"), "utf8")).toBe("given\n");
	});
	async function configureSubagent() {
		await writeFile(path.join(root, "agents", "fpga", "agent.json"), JSON.stringify({ name: "FPGA agent", tools: ["read_file"], subagents: ["helper"] }));
		const dir = path.join(root, "agents", "helper");
		await mkdir(dir);
		await writeFile(path.join(dir, "agent.json"), JSON.stringify({ name: "Helper", tools: ["write_file"] }));
		await writeFile(path.join(dir, "prompt.md"), "Write the requested file.");
	}

	it("approves delegation once and forwards child progress as notes", async () => {
		await configureSubagent();
		const model = fakeModel(["@tool ask_agent\nagent: helper\n---\nCreate a.v\n@end", WRITE, "Created it.", "Done."]);
		const session = await open(model, true);
		const done = idleAfterWork(session);
		session.send("Delegate it.");
		const proposal = await until(session, (event) => event.type === "proposal" && event.state === "pending") as Extract<SessionEvent, { type: "proposal" }>;
		expect(proposal).toMatchObject({ path: "ask_agent: helper", isNew: true, diff: [{ kind: "add", text: "Create a.v", line: 1 }] });
		expect(model.requests).toHaveLength(1);
		session.resolve(proposal.id, true);
		await done;
		expect(session.events.filter((event) => event.type === "proposal")).toHaveLength(1);
		expect(session.events.some((event) => event.type === "note" && event.tone === "info" && event.text.startsWith("  helper") && event.text.includes("write_file"))).toBe(true);
		expect(session.events.some((event) => event.type === "file" && event.path.startsWith("ask_agent:"))).toBe(false);
		expect(await readFile(path.join(workspace, "a.v"), "utf8")).toContain("module a;");
		expect(model.requests.at(-1)!.messages.at(-1)!.content).toContain("Helper finished: Created it.");
	});

	it("rejects delegation before starting the child", async () => {
		await configureSubagent();
		const model = fakeModel(["@tool ask_agent\nagent: helper\n---\nCreate a.v\n@end", "Understood."]);
		const session = await open(model, true);
		const done = idleAfterWork(session);
		session.send("Delegate it.");
		const proposal = await until(session, (event) => event.type === "proposal" && event.state === "pending") as Extract<SessionEvent, { type: "proposal" }>;
		session.resolve(proposal.id, false);
		await done;
		expect(model.requests).toHaveLength(2);
		expect(model.requests[1]!.messages.at(-1)!.content).toContain("rejected");
		await expect(stat(path.join(workspace, "a.v"))).rejects.toThrow();
	});

	it("runs delegation without an approval proposal when asking is off", async () => {
		await configureSubagent();
		const model = fakeModel(["@tool ask_agent\nagent: helper\n---\nInspect it\n@end", "Looks fine.", "Done."]);
		const session = await open(model, false);
		const done = idleAfterWork(session);
		session.send("Delegate it.");
		await done;
		expect(session.events.some((event) => event.type === "proposal")).toBe(false);
		expect(model.requests.at(-1)!.messages.at(-1)!.content).toContain("Helper finished: Looks fine.");
	});

	it("stops a delegated model request when the session is stopped", async () => {
		await configureSubagent();
		let started!: () => void;
		const childStarted = new Promise<void>((resolve) => { started = resolve; });
		let aborted = false;
		let calls = 0;
		const fetchFn: typeof fetch = async (_url, init) => {
			init?.signal?.throwIfAborted();
			if (++calls === 1) return new Response(JSON.stringify({ choices: [{ message: { content: "@tool ask_agent\nagent: helper\n---\nWait\n@end" }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } });
			return new Promise<Response>((_resolve, reject) => {
				started();
				init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("Stopped")); }, { once: true });
			});
		};
		const session = await open({ fetchFn, requests: [] }, false);
		const done = idleAfterWork(session);
		session.send("Delegate it.");
		await childStarted;
		session.stop();
		await done;
		expect(aborted).toBe(true);
	});
	it("appends unchanged check hints to both the model result and session event", async () => {
		await writeFile(path.join(workspace, "a.v"), "module a endmodule\n");
		const model = fakeModel([
			"@tool compile\nfiles: a.v\n@end", "@tool read_file\npath: a.v\n@end",
			"@tool compile\nfiles: a.v\n@end", "@tool read_file\npath: a.v\nfrom: 1\n@end",
			"@tool compile\nfiles: a.v\n@end", "Done.",
		]);
		const exec: Exec = async () => ({ code: 1, stderr: "a.v:1: syntax error", stdout: "", timedOut: false, notFound: false });
		const session = await open(model, false, exec);
		const done = idleAfterWork(session);
		session.send("Fix it.");
		await done;
		expect(model.requests[5]!.messages.at(-1)!.content).toContain("Same result 3 times.");
		expect(session.events.some((event) => event.type === "step" && event.result.includes("Same result 3 times."))).toBe(true);
	});

	it("trims session history unless disabled", async () => {
		await writeFile(path.join(workspace, "long.md"), "one\ntwo\nthree\n" + "x".repeat(600));
		for (const enabled of [true, false]) {
			await writeFile(path.join(root, "agents", "fpga", "agent.json"), JSON.stringify({ name: "Test", tools: ["read_file"], trimContext: enabled }));
			const model = fakeModel(Array.from({ length: 6 }, (_, index) => `@tool read_file\npath: long.md\nfrom: ${index + 1}\n@end`).concat("Done."));
			const session = await open(model, false);
			const done = idleAfterWork(session);
			session.send("Read it.");
			await done;
			expect(model.requests.at(-1)!.messages.some((message) => message.content.includes("(older output trimmed)"))).toBe(enabled);
		}
	});

	it("uses skills without requesting edit approval", async () => {
		const dir = path.join(root, "agents", "fpga", "skills");
		await mkdir(dir);
		await writeFile(path.join(dir, "math.md"), "---\nname: math\ndescription: Math rules\nalways: false\n---\nWiden first.");
		const model = fakeModel(["@tool use_skill\nname: math\n@end", "Done."]);
		const session = await open(model, true);
		const done = idleAfterWork(session);
		session.send("Read math.");
		await done;
		expect(session.events.some((event) => event.type === "proposal")).toBe(false);
		expect(model.requests[1]!.messages.at(-1)!.content).toContain("Widen first.");
	});
	it("waits for the user before an edit, then writes the file when accepted", async () => {
		const model = fakeModel([WRITE, "Created a.v."]);
		const session = await open(model, true);
		const done = idleAfterWork(session);
		session.send("Make module a.");

		const proposal = (await until(session, (e) => e.type === "proposal" && e.state === "pending")) as Extract<SessionEvent, { type: "proposal" }>;
		expect(proposal.path).toBe("a.v");
		expect(proposal.isNew).toBe(true);
		expect(proposal.diff).toEqual([
			{ kind: "add", text: "module a;", line: 1 },
			{ kind: "add", text: "endmodule", line: 2 },
		]);
		await until(session, (e) => e.type === "status" && e.state === "waiting");
		await expect(stat(path.join(workspace, "a.v"))).rejects.toThrow();

		session.resolve(proposal.id, true);
		await done;
		expect(await readFile(path.join(workspace, "a.v"), "utf8")).toBe("module a;\nendmodule\n");

		// The kept events are the current picture: one entry per thing, in order.
		const kinds = session.events.map((e) => (e.type === "step" ? `step:${e.status}` : e.type === "proposal" ? `proposal:${e.state}` : e.type === "status" ? `status:${e.state}` : e.type));
		expect(kinds).toEqual(["status:idle", "user", "usage", "step:ok", "proposal:accepted", "file", "agent"]);
		const step = session.events.find((e) => e.type === "step") as Extract<SessionEvent, { type: "step" }>;
		expect(step.tool).toBe("write_file");
		expect(step.target).toBe("a.v");
		expect(step.thinking).toContain("thinking it over");
		expect(step.thinking).toContain("I will create the file.");
		expect(step.call).toContain("@tool write_file");
		expect(step.result).toContain("a.v");
		expect((session.events.at(-1) as { text: string }).text).toBe("Created a.v.");
	});

	it("does not write a rejected edit and tells the model", async () => {
		const model = fakeModel([WRITE, "Understood, I will not create it."]);
		const session = await open(model, true);
		const done = idleAfterWork(session);
		session.send("Make module a.");
		const proposal = await until(session, (e) => e.type === "proposal" && e.state === "pending");
		session.resolve((proposal as { id: string }).id, false);
		await done;

		await expect(stat(path.join(workspace, "a.v"))).rejects.toThrow();
		const step = session.events.find((e) => e.type === "step") as Extract<SessionEvent, { type: "step" }>;
		expect(step.status).toBe("rejected");
		expect(session.events.some((e) => e.type === "file")).toBe(false);
		expect(model.requests[1]!.messages.at(-1)!.content).toContain("The user rejected this change.");
	});

	it("applies edits at once when asking is off, and still shows what changed", async () => {
		await writeFile(path.join(root, "agents", "fpga", "agent.json"), JSON.stringify({ name: "FPGA agent", tools: ["replace_lines"], smallFileLines: 0 }));
		await writeFile(path.join(workspace, "a.v"), "module a;\nwire x;\nendmodule\n");
		const model = fakeModel(["@tool replace_lines\npath: a.v\nfrom: 2\nto: 2\n---\nwire y;\n@end", "Renamed the wire."]);
		const session = await open(model, false);
		const done = idleAfterWork(session);
		session.send("Rename x to y.");
		await done;

		expect(await readFile(path.join(workspace, "a.v"), "utf8")).toBe("module a;\nwire y;\nendmodule\n");
		const proposal = session.events.find((e) => e.type === "proposal") as Extract<SessionEvent, { type: "proposal" }>;
		expect(proposal.state).toBe("accepted");
		expect(proposal.diff).toEqual([
			{ kind: "same", text: "module a;", line: 1 },
			{ kind: "del", text: "wire x;", line: 2 },
			{ kind: "add", text: "wire y;", line: 2 },
			{ kind: "same", text: "endmodule", line: 3 },
		]);
	});

	it("refuses a small range edit before requesting approval", async () => {
		await writeFile(path.join(workspace, "a.v"), "module a;\nendmodule\n");
		const model = fakeModel(["@tool replace_lines\npath: a.v\nfrom: 1\nto: 1\n---\nmodule b;\n@end", "I will rewrite it."]);
		const session = await open(model, true);
		const done = idleAfterWork(session);
		session.send("Change a.");
		await done;
		expect(session.events.some((event) => event.type === "proposal")).toBe(false);
		expect(model.requests[1]!.messages.at(-1)!.content).toContain("a.v has 2 lines. For a file this small");
		expect(await readFile(path.join(workspace, "a.v"), "utf8")).toContain("module a;");
	});

	it("passes a message sent while it is working to the model as steering", async () => {
		const model = fakeModel([WRITE, "Done."]);
		const session = await open(model, true);
		const done = idleAfterWork(session);
		session.send("Make module a.");
		const proposal = await until(session, (e) => e.type === "proposal" && e.state === "pending");
		session.send("Also add a clock input later.");
		session.resolve((proposal as { id: string }).id, true);
		await done;

		const last = model.requests.at(-1)!.messages.map((m) => m.content).join("\n");
		expect(last).toContain("Also add a clock input later.");
	});

	it("stops while waiting for the user", async () => {
		const model = fakeModel([WRITE, "should not be reached"]);
		const session = await open(model, true);
		const done = idleAfterWork(session);
		session.send("Make module a.");
		await until(session, (e) => e.type === "proposal" && e.state === "pending");
		session.stop();
		await done;

		await expect(stat(path.join(workspace, "a.v"))).rejects.toThrow();
		expect(session.events.some((e) => e.type === "note" && e.text === "Stopped by you.")).toBe(true);
	});
});

describe("lineDiff", () => {
	it("returns nothing for equal texts", () => {
		expect(lineDiff("a\nb\n", "a\nb\n")).toEqual([]);
	});

	it("keeps only the change and its neighbours", () => {
		const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
		const after = before.replace("line 10", "LINE TEN");
		const diff = lineDiff(before, after, 1);
		expect(diff).toEqual([
			{ kind: "same", text: "line 9", line: 9 },
			{ kind: "del", text: "line 10", line: 10 },
			{ kind: "add", text: "LINE TEN", line: 10 },
			{ kind: "same", text: "line 11", line: 11 },
		]);
	});

	it("handles insertions, deletions and an empty side", () => {
		expect(lineDiff("", "x\ny\n")).toEqual([
			{ kind: "add", text: "x", line: 1 },
			{ kind: "add", text: "y", line: 2 },
		]);
		expect(lineDiff("x\ny\n", "y\n", 0)).toEqual([{ kind: "del", text: "x", line: 1 }]);
		expect(lineDiff("a\nc\n", "a\nb\nc\n", 0)).toEqual([{ kind: "add", text: "b", line: 2 }]);
	});
});
