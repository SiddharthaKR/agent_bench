import { FINAL_CHECK_FAILED, SAVE_REMINDER } from "../src/agent.ts";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "../src/agent.ts";
import type { ChatMessage } from "../src/model.ts";
import type { Exec, ExecResult } from "../src/types.ts";

/** A model that answers from a script and records what it was sent. */
function fakeModel(replies: string[] | ((n: number) => string)) {
	const requests: { messages: ChatMessage[]; stop?: string[] }[] = [];
	const fetchFn = (async (_url: unknown, init?: { body?: unknown }) => {
		const body = JSON.parse(String(init?.body));
		requests.push(body);
		const n = requests.length;
		const content = typeof replies === "function" ? replies(n) : (replies[n - 1] ?? "Done.");
		return new Response(
			JSON.stringify({
				choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
				usage: { prompt_tokens: 100 * n, completion_tokens: 20, total_tokens: 100 * n + 20 },
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}) as unknown as typeof fetch;
	return { fetchFn, requests };
}

const okExec: Exec = async () => ({ code: 0, stdout: "", stderr: "", timedOut: false, notFound: false }) satisfies ExecResult;

it("keeps read specs across tool context copies", async () => {
	await writeFile(path.join(workspace, "spec.md"), "```\nmodule m(input a);\n```");
	await writeFile(path.join(workspace, "m.v"), "module m(input b); endmodule");
	const model = fakeModel([
		"@tool read_file\npath: spec.md\n@end",
		"@tool compile\nfiles: m.v\n@end",
		"Done.",
	]);
	await run(model);
	expect(JSON.stringify(model.requests)).toContain("Missing: a. Extra: b.");
});

let root: string;
let agentDir: string;
let workspace: string;
let runsDir: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "agentbench-"));
	agentDir = path.join(root, "agents", "fpga");
	workspace = path.join(root, "work");
	runsDir = path.join(root, "runs");
	await mkdir(agentDir, { recursive: true });
	await mkdir(workspace, { recursive: true });
	await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "FPGA agent", tools: ["read_file", "write_file", "replace_lines", "compile", "run_sim"], maxTurns: 20 }));
	await writeFile(path.join(agentDir, "prompt.md"), "You are an FPGA engineer.\n");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function run(model: ReturnType<typeof fakeModel>, exec: Exec = okExec) {
	return runAgent({
		agentDir,
		workspace,
		task: "Write a gain block.",
		server: { baseUrl: "http://fake/v1", model: "fake" },
		commands: { compile: ["iverilog", "-o", "{out}", "{files}"], simulate: ["vvp", "{out}"] },
		runsDir,
		exec,
		fetchFn: model.fetchFn,
	});
}

async function traceEvents(dir: string) {
	const text = await readFile(path.join(dir, "trace.jsonl"), "utf8");
	return text.trim().split("\n").map((line) => JSON.parse(line) as { type: string; [k: string]: unknown });
}

describe("runAgent with a scripted model", () => {
	it("uses the configured whole-file limit for compile advice", async () => {
		await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "Test", tools: ["compile"], smallFileLines: 2 }));
		await writeFile(path.join(workspace, "a.v"), "module a;\nbad\nendmodule\n");
		const model = fakeModel(["@tool compile\nfiles: a.v\n@end", "Done."]);
		await run(model, async () => ({ code: 1, stderr: "a.v:2: syntax error", stdout: "", timedOut: false, notFound: false }));
		expect(model.requests[1]!.messages.at(-1)!.content).toContain("Hint: a.v has 3 lines. Fix only the reported lines");
	});

	it("still reminds after a failed write", async () => {
		const model = fakeModel(["@tool write_file\npath: ../outside.v\n---\nx\n@end", "module a; endmodule", "Done."]);
		expect((await run(model)).modelCalls).toBe(3);
		expect(model.requests[2]!.messages.at(-1)!.content).toBe(SAVE_REMINDER);
	});
	it.each(["```verilog\nmodule a; endmodule\n```", "module a;\nendmodule"])("reminds once about unsaved code: %s", async (code) => {
		const model = fakeModel([code, code, "Should not be reached"]);
		const result = await run(model);
		expect(result.modelCalls).toBe(2);
		expect(model.requests[1]!.messages.at(-1)).toMatchObject({ role: "user", content: SAVE_REMINDER });
		expect(await traceEvents(result.traceDir)).toContainEqual(expect.objectContaining({ type: "guard", reason: expect.stringContaining("nothing is saved") }));
	});

	it("compiles changed Verilog before the run may end and hands back a failure", async () => {
		let compiles = 0;
		const exec: Exec = async () => {
			compiles++;
			return compiles === 1
				? { code: 1, stdout: "", stderr: "a.v:1: syntax error\n", timedOut: false, notFound: false }
				: { code: 0, stdout: "", stderr: "", timedOut: false, notFound: false };
		};
		const model = fakeModel([
			"@tool write_file\npath: a.v\n---\nmodule a endmodule\n@end",
			"Done.",
			"@tool write_file\npath: a.v\n---\nmodule a; endmodule\n@end",
			"Fixed.",
		]);
		const result = await run(model, exec);
		expect(result.reason).toBe("done");
		expect(result.modelCalls).toBe(4);
		expect(String(model.requests[2]!.messages.at(-1)!.content)).toContain(FINAL_CHECK_FAILED);
		expect(String(model.requests[2]!.messages.at(-1)!.content)).toContain("syntax error");
		expect(compiles).toBe(2);
		const events = await traceEvents(result.traceDir);
		expect(events).toContainEqual(expect.objectContaining({ type: "guard", reason: expect.stringContaining("Final check: compile a.v: failed") }));
		expect(events).toContainEqual(expect.objectContaining({ type: "guard", reason: expect.stringContaining("Final check: compile a.v: ok") }));
	});

	it("does not run the final check when the model compiled its last change, or changed no Verilog", async () => {
		let compiles = 0;
		const exec: Exec = async () => { compiles++; return { code: 0, stdout: "", stderr: "", timedOut: false, notFound: false }; };
		const compiled = fakeModel(["@tool write_file\npath: a.v\n---\nmodule a; endmodule\n@end", "@tool compile\nfiles: a.v\n@end", "Done."]);
		expect((await run(compiled, exec)).modelCalls).toBe(3);
		expect(compiles).toBe(1);
		const notes = fakeModel(["@tool write_file\npath: notes.md\n---\nhello\n@end", "Done."]);
		expect((await run(notes, exec)).modelCalls).toBe(2);
		expect(compiles).toBe(1);
	});

	it("does not remind after a successful write or a plain answer", async () => {
		const model = fakeModel(["@tool write_file\npath: a.v\n---\nmodule a; endmodule\n@end", "```verilog\nmodule a; endmodule\n```"]);
		expect((await run(model)).modelCalls).toBe(2);
		expect((await run(fakeModel(["No changes needed."]))).modelCalls).toBe(1);
	});
	it("reserves the internal malformed-call tool name when adding MCP tools", async () => {
		await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "MCP", tools: [], mcp: [{ name: "invalid", command: process.execPath, args: [path.resolve("test/fixtures/mcp-echo-server.mjs"), "--internal-call"], enabled: true }] }));
		const model = fakeModel(["@tool unknown\n@end", "Done."]);
		const result = await run(model);
		expect(await traceEvents(result.traceDir)).toContainEqual(expect.objectContaining({ text: expect.stringContaining('Tool name "invalid_call" is already in use.') }));
		expect(model.requests[1]!.messages.at(-1)!.content).toContain("Write the call again");
	}, 30_000);

	it("does not apply the built-in edit policy to MCP tools with edit names", async () => {
		await writeFile(path.join(workspace, "small.txt"), "A small file.\n");
		await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "MCP", tools: [], mcp: [{ name: "replace", command: process.execPath, args: [path.resolve("test/fixtures/mcp-echo-server.mjs"), "--edit-lines"], enabled: true }] }));
		const model = fakeModel(["@tool replace_lines\npath: small.txt\nfrom: 1\nto: 1\n@end", "Done."]);
		const result = await run(model);
		expect(result.toolErrors).toBe(0);
		expect(model.requests[1]!.messages.at(-1)!.content).toContain("MCP result");
	}, 30_000);

	it("adds MCP tools to the prompt and sends their results back to the model", async () => {
		const pidFile = path.join(root, "mcp-pid");
		await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "MCP", tools: [], mcp: [{ name: "docs", command: process.execPath, args: [path.resolve("test/fixtures/mcp-echo-server.mjs")], env: { MCP_PID_FILE: pidFile }, enabled: true }] }));
		const model = fakeModel(["@tool docs_echo\ntext: hello MCP\n@end", "Received it."]);
		const result = await run(model);
		expect(result.reason).toBe("done");
		expect(result.toolCalls).toBe(1);
		expect(result.toolErrors).toBe(0);
		expect(model.requests[0]!.messages[0]!.content).toContain("docs_echo");
		expect(model.requests[0]!.messages[0]!.content).toContain("Add two numbers for $&.");
		expect(model.requests[1]!.messages.at(-1)!.content).toContain("hello MCP\nend");
		const pid = Number(await readFile(pidFile, "utf8"));
		expect(() => process.kill(pid, 0)).toThrow();
	}, 30_000);

	it("traces MCP startup problems and continues the run", async () => {
		await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "MCP", tools: [], mcp: [{ name: "docs", command: "missing-mcp-command-123", args: [], enabled: true }] }));
		const result = await run(fakeModel(["Done."]));
		expect(result.reason).toBe("done");
		expect(await traceEvents(result.traceDir)).toContainEqual(expect.objectContaining({ text: expect.stringContaining('MCP server "docs" could not start:') }));
	}, 30_000);

	it("refuses small range edits but allows whole-file rewrites", async () => {
		await writeFile(path.join(workspace, "a.v"), "old\n");
		const model = fakeModel(["@tool replace_lines\npath: a.v\nfrom: 1\nto: 1\n---\nwrong\n@end", "@tool write_file\npath: a.v\n---\nnew\n@end", "Done."]);
		const result = await run(model);
		expect(result.toolErrors).toBe(1);
		expect(model.requests[1]!.messages.at(-1)!.content).toContain("a.v has 1 lines. For a file this small, read it and rewrite the whole file with write_file.");
		expect(await readFile(path.join(workspace, "a.v"), "utf8")).toBe("new\n");
	});

	it("loads an optional skill as an ordinary read tool", async () => {
		await mkdir(path.join(agentDir, "skills"));
		await writeFile(path.join(agentDir, "skills", "math.md"), "---\nname: math\ndescription: Signed math\nalways: false\n---\nWiden first.");
		const model = fakeModel(["@tool use_skill\nname: math\n@end", "Read it."]);
		const result = await run(model);
		expect(result.toolErrors).toBe(0);
		expect(model.requests[1]!.messages.at(-1)!.content).toContain("Widen first.");
	});

	it("appends unchanged failure hints through the afterToolCall hook", async () => {
		await writeFile(path.join(workspace, "a.v"), "module a endmodule\n");
		const model = fakeModel([
			"@tool compile\nfiles: a.v\n@end", "@tool read_file\npath: a.v\n@end",
			"@tool compile\nfiles: a.v\n@end", "@tool read_file\npath: a.v\nfrom: 1\n@end",
			"@tool compile\nfiles: a.v\n@end", "Done.",
		]);
		const failing: Exec = async () => ({ code: 1, stderr: "a.v:1: syntax error", stdout: "", timedOut: false, notFound: false });
		await run(model, failing);
		expect(model.requests[5]!.messages.at(-1)!.content).toContain("Same result 3 times.");
	});

	it("trims older output in model requests and can disable trimming", async () => {
		await writeFile(path.join(workspace, "long.md"), "first\nsecond\nthird\n" + "x".repeat(600));
		for (const enabled of [true, false]) {
			await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "Test", tools: ["read_file"], trimContext: enabled }));
			const model = fakeModel(Array.from({ length: 6 }, (_, index) => `@tool read_file\npath: long.md\nfrom: ${index + 1}\n@end`).concat("Done."));
			await run(model);
			expect(model.requests.at(-1)!.messages.some((message) => message.content.includes("(older output trimmed)"))).toBe(enabled);
		}
	});

	it("aborts a never-ending model at the option time limit, overriding the agent default", async () => {
		await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "Test", tools: [], maxSeconds: 600 }));
		let reached!: () => void;
		const started = new Promise<void>((resolve) => { reached = resolve; });
		const fetchFn: typeof fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
			reached();
			init?.signal?.addEventListener("abort", () => reject(new Error("Stopped")), { once: true });
		});
		vi.useFakeTimers();
		try {
			const pending = runAgent({ agentDir, workspace, runsDir, task: "Wait", server: { baseUrl: "http://fake/v1", model: "fake" }, commands: { compile: [], simulate: [] }, fetchFn, maxSeconds: 2 });
			await started;
			await vi.advanceTimersByTimeAsync(2000);
			const result = await pending;
			expect(result.reason).toBe("time");
			expect(result.error).toBeUndefined();
			expect(vi.getTimerCount()).toBe(0);
		} finally { vi.useRealTimers(); }
	});

	it("clears the timer when the run finishes itself", async () => {
		await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "Test", tools: [], maxSeconds: 600 }));
		vi.useFakeTimers();
		try {
			expect((await run(fakeModel(["Done."]))).reason).toBe("done");
			expect(vi.getTimerCount()).toBe(0);
		} finally { vi.useRealTimers(); }
	});

	it("uses the agent time limit and keeps existing text when a later model call hangs", async () => {
		await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "Test", tools: ["read_file"], maxSeconds: 1 }));
		await writeFile(path.join(workspace, "a.v"), "module a; endmodule\n");
		let reached!: () => void;
		const started = new Promise<void>((resolve) => { reached = resolve; });
		let calls = 0;
		const fetchFn: typeof fetch = async (_url, init) => {
			if (++calls === 1) return new Response(JSON.stringify({ choices: [{ message: { content: "Preparing.\n@tool read_file\npath: a.v\n@end" }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } });
			return new Promise<Response>((_resolve, reject) => {
				reached();
				init?.signal?.addEventListener("abort", () => reject(new Error("Stopped")), { once: true });
			});
		};
		vi.useFakeTimers();
		try {
			const pending = runAgent({ agentDir, workspace, runsDir, task: "Wait", server: { baseUrl: "http://fake/v1", model: "fake" }, commands: { compile: [], simulate: [] }, fetchFn });
			await started;
			await vi.advanceTimersByTimeAsync(1000);
			const result = await pending;
			expect(result).toMatchObject({ reason: "time", finalText: "Preparing." });
			expect(result.error).toBeUndefined();
		} finally { vi.useRealTimers(); }
	});
	it("writes a file, compiles it, and finishes", async () => {
		const model = fakeModel([
			// No @end: the server cuts the reply at the stop sequence.
			"I will write the module.\n@tool write_file\npath: rtl/gain.v\n---\nmodule gain (\n  input wire clk\n);\nendmodule",
			"@tool compile\nfiles: rtl/gain.v\n@end",
			"Done. gain.v compiles.",
		]);
		const result = await run(model);

		expect(result.reason).toBe("done");
		expect(result.finalText).toBe("Done. gain.v compiles.");
		expect(result.modelCalls).toBe(3);
		expect(result.toolCalls).toBe(2);
		expect(result.toolErrors).toBe(0);
		expect(result.invalidCalls).toBe(0);
		expect(await readFile(path.join(workspace, "rtl", "gain.v"), "utf8")).toBe("module gain (\n  input wire clk\n);\nendmodule\n");

		// What the model was sent: a short system prompt, the task, then call and result as plain text.
		const first = model.requests[0]!;
		expect("stop" in first).toBe(false);
		expect(first.messages[0]!.role).toBe("system");
		expect(first.messages[0]!.content).toContain("You are an FPGA engineer.");
		expect(first.messages[0]!.content).toContain("write_file");
		expect(first.messages[1]).toEqual({ role: "user", content: "Write a gain block." });
		expect("tools" in first).toBe(false);

		const third = model.requests[2]!.messages;
		expect(third.map((m) => m.role)).toEqual(["system", "user", "assistant", "user", "assistant", "user"]);
		expect(third[2]!.content).toContain("@tool write_file");
		expect(third[2]!.content).toContain("module gain");
		expect(third[3]!.content).toMatch(/^@result write_file ok/);
		expect(third[5]!.content).toMatch(/^@result compile ok/);

		const events = await traceEvents(result.traceDir);
		expect(events[0]!.type).toBe("run_start");
		expect(events.filter((e) => e.type === "request")).toHaveLength(3);
		expect(events.filter((e) => e.type === "response")).toHaveLength(3);
		expect(events.filter((e) => e.type === "tool_result")).toHaveLength(2);
		expect(events.at(-1)!.type).toBe("run_end");
		const summary = JSON.parse(await readFile(path.join(result.traceDir, "summary.json"), "utf8"));
		expect(summary.reason).toBe("done");
		expect(summary.lastPromptTokens).toBe(300);
	});

	it("tells the model what was wrong with an unreadable or unknown call, and recovers", async () => {
		const model = fakeModel([
			"@tool write_file\n---\nmodule a; endmodule\n@end", // path missing
			"@tool make_file\npath: a.v\n@end", // no such tool
			"@tool write_file\npath: a.v\n---\nmodule a; endmodule\n@end",
			"Done.",
		]);
		const result = await run(model);

		expect(result.reason).toBe("done");
		expect(result.invalidCalls).toBe(2);
		expect(result.toolErrors).toBe(0);
		const second = model.requests[1]!.messages;
		// The model's own wrong text is replayed as it wrote it, followed by a clear error.
		expect(second.at(-2)!.content).toContain("@tool write_file");
		expect(second.at(-1)!.content).toContain('write_file needs a "path: ..." line.');
		expect(model.requests[2]!.messages.at(-1)!.content).toContain('There is no tool named "make_file"');
		expect(await readFile(path.join(workspace, "a.v"), "utf8")).toBe("module a; endmodule\n");
	});

	it("accepts an empty --- on a tool without text, and never treats an empty reply as finished", async () => {
		await writeFile(path.join(workspace, "spec.md"), "Build a gain block.\n");
		const model = fakeModel(["@tool read_file\npath: spec.md\n---\n@end", "", "Read the spec."]);
		const result = await run(model);

		expect(result.reason).toBe("done");
		expect(result.finalText).toBe("Read the spec.");
		expect(result.invalidCalls).toBe(1);
		expect(model.requests[1]!.messages.at(-1)!.content).toContain("Build a gain block.");
		expect(model.requests[2]!.messages.at(-1)!.content).toContain("Your reply was empty.");
	});

	it("stops a model that repeats the same call forever", async () => {
		const model = fakeModel(() => "@tool compile\nfiles: a.v\n@end");
		await writeFile(path.join(workspace, "a.v"), "module a; endmodule\n");
		const result = await run(model);

		expect(result.reason).toBe("loop");
		expect(result.blocked).toBe(3);
		// Two allowed calls, three blocked ones, then the run ends.
		expect(result.modelCalls).toBe(5);
		const events = await traceEvents(result.traceDir);
		expect(events.filter((e) => e.type === "guard")).toHaveLength(3);
	});

	it("reports a compile failure to the model as an error result", async () => {
		await writeFile(path.join(workspace, "a.v"), "module a endmodule\n");
		const failing: Exec = async () => ({ code: 2, stdout: "", stderr: "a.v:1: syntax error\n", timedOut: false, notFound: false });
		const model = fakeModel(["@tool compile\nfiles: a.v\n@end", "I could not fix it."]);
		const result = await run(model, failing);

		expect(result.reason).toBe("done");
		expect(result.toolErrors).toBe(1);
		expect(model.requests[1]!.messages.at(-1)!.content).toMatch(/^@result compile error\n[\s\S]*a\.v:1: syntax error/);
	});

	it("reports an unreachable model server as an error", async () => {
		const fetchFn = (async () => {
			throw new Error("connect ECONNREFUSED");
		}) as unknown as typeof fetch;
		const result = await runAgent({
			agentDir,
			workspace,
			task: "x",
			server: { baseUrl: "http://fake/v1", model: "fake" },
			commands: { compile: ["iverilog"], simulate: ["vvp"] },
			runsDir,
			exec: okExec,
			fetchFn,
		});
		expect(result.reason).toBe("error");
		expect(result.error).toContain("Could not reach the model server");
	});
});

it("offers ask_user only to a listed top-level agent", async () => {
	const { loadAgent } = await import("../src/agent.ts");
	await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "Test", tools: ["ask_user"] }));
	expect((await loadAgent(agentDir)).specs.map((s) => s.name)).toContain("ask_user");
	expect((await loadAgent(agentDir, { depth: 1 })).specs.map((s) => s.name)).not.toContain("ask_user");
	await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "Test", tools: [] }));
	expect((await loadAgent(agentDir)).specs.map((s) => s.name)).not.toContain("ask_user");
});
it("excludes answering time and writes question counts and trace rows", async () => {
	await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "Test", tools: ["ask_user"] }));
	const model = fakeModel(["@tool ask_user\nassumption: One cycle.\n---\nLatency?\n@end", "Done."]);
	const result = await runAgent({ agentDir, workspace, task: "Work", server: { baseUrl: "http://fake/v1", model: "fake" }, commands: { compile: [], simulate: [] }, runsDir, fetchFn: model.fetchFn, maxSeconds: 0.15,
		onQuestion: async () => { await new Promise((resolve) => setTimeout(resolve, 200)); return "Two cycles."; } });
	expect(result.reason).toBe("done");
	expect(result).toMatchObject({ questions: 1, unanswered: 0 });
	expect(model.requests[1]!.messages.at(-1)!.content).toContain("Answer: Two cycles.");
	const { readTrace } = await import("../src/traces.ts");
	expect((await readTrace(runsDir, path.basename(result.traceDir)))!.rows.some((row) => row.kind === "question")).toBe(true);
});

it("uses the unavailable result without a code API hook", async () => {
	await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "Test", tools: ["ask_user"] }));
	const model = fakeModel(["@tool ask_user\n---\nReset?\n@end", "Done."]);
	const result = await run(model);
	expect(model.requests[1]!.messages.at(-1)!.content).toContain("No one can answer now. Continue with your assumption and state it in your final summary.");
	expect(JSON.parse(await readFile(path.join(result.traceDir, "summary.json"), "utf8"))).toMatchObject({ questions: 1, unanswered: 1 });
});
