import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runAgent } from "./agent.ts";
import { loadConfig } from "./config.ts";
import type { Workflow, WorkflowEvent, WorkflowRunState } from "./shared/api.ts";
import { realExec } from "./tools/index.ts";
import type { Exec } from "./types.ts";
import { createWorkflowRun } from "./workflow.ts";

export { runAgent, loadAgent } from "./agent.ts";
export type { AgentFile, LoadAgentOptions, RunOptions, RunResult, EndReason } from "./agent.ts";
export { createSession } from "./session.ts";
export type { SessionOptions } from "./session.ts";
export { createWorkflowRun, validateWorkflow, fillPlaceholders } from "./workflow.ts";
export type { WorkflowDeps } from "./workflow.ts";
export { loadConfig } from "./config.ts";
export type { Config } from "./config.ts";
export { createEngine } from "./engine.ts";
export type { EngineOptions } from "./engine.ts";
export { loadSkills } from "./skills.ts";
export type { Skill } from "./skills.ts";
export { trimContext } from "./context.ts";
export type { TrimOptions } from "./context.ts";
export { LoopGuard } from "./guard.ts";
export type { GuardOptions } from "./guard.ts";
export { realExec } from "./tools/index.ts";
export type { Exec, ExecResult, CommandConfig } from "./types.ts";
export type { ServerConfig } from "./model.ts";
export type * from "./shared/api.ts";
export type * from "./shared/engine.ts";

export interface RunWorkflowOptions {
	root: string;
	workflow: Workflow | string;
	folder: string;
	task: string;
	server?: string;
	model?: string;
	vars?: Record<string, string>;
	onEvent?: (event: WorkflowEvent) => void;
	autoContinue?: boolean;
	exec?: Exec;
	fetchFn?: typeof fetch;
	maxSeconds?: number;
}

/** Shared setup for the command line and code API. */
export async function prepareWorkflowRun(options: RunWorkflowOptions) {
	const root = path.resolve(options.root);
	const config = await loadConfig(root);
	const serverId = options.server ?? "local";
	const server = config.servers[serverId];
	if (!server) throw new Error(`No model server named "${serverId}" in config.json.`);
	const workflow = typeof options.workflow === "string"
		? JSON.parse(await readFile(options.workflow, "utf8")) as Workflow
		: structuredClone(options.workflow);
	workflow.vars = { ...workflow.vars, ...options.vars };
	const workspace = path.resolve(options.folder);
	const exec = options.exec ?? realExec;
	const run = createWorkflowRun(randomUUID(), workflow, options.task, {
		workspace,
		exec,
		runAgent: async (step, task, signal, onLine) => {
			if (!/^[A-Za-z0-9_-]+$/.test(step.agent)) throw new Error("Invalid agent name.");
			const result = await runAgent({
				agentDir: path.join(root, "agents", step.agent), workspace, task,
				server: { ...server, model: step.model ?? options.model ?? server.model, temperature: step.temperature ?? server.temperature },
				commands: config.commands, runsDir: path.join(root, "runs"), exec,
				signal, onStep: onLine, maxSeconds: options.maxSeconds, fetchFn: options.fetchFn,
				overrides: { maxTurns: step.maxTurns, tools: step.tools },
			});
			if (result.finalText) onLine(result.finalText);
			if (result.reason === "time") onLine("Ended: time");
			return { ok: result.reason === "done", text: result.finalText || result.error || `The agent ended with: ${result.reason}.` };
		},
	});
	return { workflow, run };
}

export async function runWorkflow(options: RunWorkflowOptions): Promise<WorkflowRunState> {
	const { run } = await prepareWorkflowRun(options);
	return new Promise((resolve) => {
		const unsubscribe = run.subscribe((event) => {
			try { options.onEvent?.(structuredClone(event)); } catch { /* Listeners cannot interrupt work. */ }
			if (event.type !== "state") return;
			const status = event.state.status;
			if (status === "paused" && (options.autoContinue ?? true)) {
				queueMicrotask(() => run.resume());
			} else if (["done", "failed", "stopped", "paused"].includes(status)) {
				unsubscribe();
				resolve(event.state);
			}
		});
		run.start();
	});
}
