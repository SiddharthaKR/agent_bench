import { readFile } from "node:fs/promises";
import path from "node:path";
import { runAgent } from "./agent.ts";
import type { AgentFile, RunOptions } from "./agent.ts";
import type { ToolOutput, ToolSpec, TraceWriter } from "./types.ts";

export type SubagentRunner = (id: string, task: string, signal?: AbortSignal) => Promise<ToolOutput>;

function agentDirOf(parentDir: string, id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid agent id "${id}".`);
	return path.join(path.dirname(parentDir), id);
}

export async function subagentTool(parentDir: string, ids: string[], runner?: SubagentRunner): Promise<ToolSpec> {
	const agents = await Promise.all(ids.map(async (id) => {
		const file = JSON.parse(await readFile(path.join(agentDirOf(parentDir, id), "agent.json"), "utf8")) as AgentFile;
		return `${id}: ${file.name}`;
	}));
	return {
		name: "ask_agent",
		summary: "Hand a piece of work to another agent. It starts fresh and returns a short summary.",
		args: [{ name: "agent", type: "string", required: true, help: `Available agents: ${agents.join("; ")}` }],
		body: { help: "the task text (required)" },
		async run(args, ctx) {
			const id = String(args.agent ?? "");
			if (!ids.includes(id)) return { ok: false, text: `Unknown agent "${id}". Available agents: ${ids.join(", ")}.` };
			const task = typeof args.content === "string" ? args.content : "";
			if (!task.trim()) return { ok: false, text: "ask_agent needs task text after a --- line." };
			if (!runner) return { ok: false, text: "This agent has no sub-agent runner." };
			return runner(id, task, ctx.signal);
		},
	};
}

export function createSubagentRunner(options: RunOptions, trace: TraceWriter, remainingSeconds: () => number | undefined): SubagentRunner {
	return async (id, task, signal) => {
		let name = id;
		try {
			const agentDir = agentDirOf(options.agentDir, id);
			const file = JSON.parse(await readFile(path.join(agentDir, "agent.json"), "utf8")) as AgentFile;
			name = file.name;
			const result = await runAgent({
				...options,
				agentDir,
				task,
				depth: (options.depth ?? 0) + 1,
				overrides: undefined,
				maxSeconds: remainingSeconds(),
				signal: signal ?? options.signal,
				onStep: (line) => options.onStep?.(`  ${id} ${line}`),
			});
			trace.write({ type: "subagent", agent: id, task: task.slice(0, 200), reason: result.reason, traceDir: result.traceDir });
			const text = (result.finalText || result.error || "").slice(0, 1500);
			return result.reason === "done"
				? { ok: true, text: `${name} finished: ${text}` }
				: { ok: false, text: `${name} could not finish (${result.reason}). ${text}` };
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			trace.write({ type: "subagent", agent: id, task: task.slice(0, 200), reason: "error", traceDir: "" });
			return { ok: false, text: `${name} could not finish (error). ${text.slice(0, 1500)}` };
		}
	};
}
