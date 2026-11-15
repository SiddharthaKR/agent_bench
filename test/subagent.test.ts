import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAgent, runAgent } from "../src/agent.ts";
import type { RunOptions } from "../src/agent.ts";
import type { ChatMessage } from "../src/model.ts";

let root: string;
let options: RunOptions;

async function agent(id: string, file: Record<string, unknown>) {
	const dir = path.join(root, "agents", id);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "agent.json"), JSON.stringify(file));
	await writeFile(path.join(dir, "prompt.md"), `You are ${id}.`);
	return dir;
}

function model(replies: string[]) {
	const requests: { messages: ChatMessage[] }[] = [];
	const fetchFn: typeof fetch = async (_url, init) => {
		requests.push(JSON.parse(String(init?.body)));
		return new Response(JSON.stringify({ choices: [{ message: { content: replies[requests.length - 1] ?? "Done." }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } });
	};
	return { requests, fetchFn };
}

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "subagents-"));
	const agentDir = await agent("main", { name: "Main", tools: ["read_file", "write_file"], subagents: ["helper"] });
	await agent("helper", { name: "Helpful agent", tools: ["read_file"], subagents: ["main"] });
	const workspace = path.join(root, "work");
	await mkdir(workspace);
	await writeFile(path.join(workspace, "spec.md"), "The specification.");
	options = { agentDir, workspace, runsDir: path.join(root, "runs"), task: "Build it", server: { baseUrl: "http://fake/v1", model: "fake" }, commands: { compile: [], simulate: [] } };
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("sub-agents", () => {
	it("returns protection advice before the small-file edit policy", async () => {
		await agent("main", { name: "Main", tools: ["replace_lines"] });
		const fake = model(["@tool replace_lines\npath: spec.md\nfrom: 1\nto: 1\n---\nchanged\n@end", "Done."]);
		await runAgent({ ...options, protect: ["spec.md"], fetchFn: fake.fetchFn });
		expect(fake.requests[1]!.messages.at(-1)!.content).toContain("spec.md is given and must not be changed.");
		expect(await readFile(path.join(options.workspace, "spec.md"), "utf8")).toBe("The specification.");
	});
	it("inherits protected paths in the child", async () => {
		await agent("helper", { name: "Helpful agent", tools: ["write_file"] });
		const fake = model(["@tool ask_agent\nagent: helper\n---\nCheck\n@end", "@tool write_file\npath: spec.md\n---\nchanged\n@end", "Blocked.", "Done."]);
		await runAgent({ ...options, protect: ["spec.md"], fetchFn: fake.fetchFn });
		expect(fake.requests[2]!.messages.at(-1)!.content).toContain("spec.md is given and must not be changed.");
		expect(await readFile(path.join(options.workspace, "spec.md"), "utf8")).toBe("The specification.");
	});
	it("does not start a model request when already aborted during setup", async () => {
		const fake = model(["Done."]);
		const controller = new AbortController();
		const pending = runAgent({ ...options, fetchFn: fake.fetchFn, signal: controller.signal });
		controller.abort();
		expect((await pending).reason).toBe("aborted");
		expect(fake.requests).toHaveLength(0);
	});

	it("lists configured ids and names, and hides delegation at depth one or without configuration", async () => {
		const loaded = await loadAgent(options.agentDir);
		expect(loaded.specs.map((tool) => tool.name)).toContain("ask_agent");
		expect(loaded.systemPrompt).toContain("helper: Helpful agent");
		expect((await loadAgent(options.agentDir, { depth: 1 })).specs.map((tool) => tool.name)).not.toContain("ask_agent");
		const plain = await agent("plain", { name: "Plain", tools: [] });
		expect((await loadAgent(plain)).specs.map((tool) => tool.name)).not.toContain("ask_agent");
	});

	it("runs in fresh context, returns a short summary, forwards lines and records the child trace", async () => {
		const fake = model(["@tool ask_agent\nagent: helper\n---\nCheck the spec\n@end", "@tool read_file\npath: spec.md\n@end", "The spec passes.", "All done."]);
		const lines: string[] = [];
		const result = await runAgent({ ...options, fetchFn: fake.fetchFn, onStep: (line) => lines.push(line) });
		expect(result.reason).toBe("done");
		expect(fake.requests[1]!.messages).toHaveLength(2);
		expect(fake.requests[1]!.messages[1]!.content).toBe("Check the spec");
		expect(fake.requests[1]!.messages[0]!.content).not.toContain("ask_agent");
		expect(fake.requests[3]!.messages.at(-1)!.content).toContain("Helpful agent finished: The spec passes.");
		expect(lines.some((line) => line.startsWith("  helper ") && line.includes("read_file"))).toBe(true);
		const events = (await readFile(path.join(result.traceDir, "trace.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
		const child = events.find((event) => event.type === "subagent");
		expect(child).toMatchObject({ agent: "helper", task: "Check the spec", reason: "done" });
		expect(child.traceDir).not.toBe(result.traceDir);
		expect(await readFile(path.join(child.traceDir, "summary.json"), "utf8")).toContain('"reason": "done"');
	});

	it("returns an error for unknown agents and requires task text", async () => {
		const fake = model(["@tool ask_agent\nagent: absent\n---\nCheck\n@end", "@tool ask_agent\nagent: helper\n@end", "Done."]);
		await runAgent({ ...options, fetchFn: fake.fetchFn });
		expect(fake.requests[1]!.messages.at(-1)!.content).toContain("Unknown agent");
		expect(fake.requests[2]!.messages.at(-1)!.content).toContain("task text");
	});

	it("reports a child tool limit as could not finish", async () => {
		await agent("helper", { name: "Helpful agent", tools: ["read_file"], maxTurns: 1 });
		const fake = model(["@tool ask_agent\nagent: helper\n---\nCheck\n@end", "@tool read_file\npath: spec.md\n@end", "@tool read_file\npath: spec.md\n@end", "Done."]);
		await runAgent({ ...options, fetchFn: fake.fetchFn });
		expect(fake.requests.at(-1)!.messages.at(-1)!.content).toContain("Helpful agent could not finish (limit).");
	});

	it("cuts successful summaries to 1500 characters", async () => {
		const fake = model(["@tool ask_agent\nagent: helper\n---\nCheck\n@end", "x".repeat(1600), "Done."]);
		await runAgent({ ...options, fetchFn: fake.fetchFn });
		const result = fake.requests[2]!.messages.at(-1)!.content;
		expect(result).toContain("x".repeat(1500));
		expect(result).not.toContain("x".repeat(1501));
	});
});

describe("agent overrides", () => {
	it("shrinks help and execution to the allowed subset", async () => {
		const fake = model(["@tool write_file\npath: forbidden.txt\n---\nOops\n@end", "Done."]);
		await runAgent({ ...options, fetchFn: fake.fetchFn, overrides: { tools: ["read_file"] } });
		expect(fake.requests[0]!.messages[0]!.content).not.toContain("write_file");
		expect(fake.requests[0]!.messages[0]!.content).not.toContain("ask_agent");
		expect(fake.requests[1]!.messages.at(-1)!.content).toContain('There is no tool named "write_file"');
		await expect(readFile(path.join(options.workspace, "forbidden.txt"))).rejects.toThrow();
	});

	it("rejects tools outside the agent's configuration before calling the model", async () => {
		const fake = model(["Done."]);
		await expect(runAgent({ ...options, fetchFn: fake.fetchFn, overrides: { tools: ["compile"] } })).rejects.toThrow('Tool "compile" is not available to agent "Main".');
		expect(fake.requests).toHaveLength(0);
	});

	it("uses the overridden tool-call limit", async () => {
		const fake = model(["@tool read_file\npath: spec.md\n@end", "@tool read_file\npath: spec.md\n@end"]);
		const result = await runAgent({ ...options, fetchFn: fake.fetchFn, overrides: { maxTurns: 1 } });
		expect(result.reason).toBe("limit");
	});
});
