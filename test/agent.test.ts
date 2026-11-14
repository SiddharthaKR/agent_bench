import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
