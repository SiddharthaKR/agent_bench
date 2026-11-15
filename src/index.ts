import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runAgent } from "./agent.ts";
import { loadConfig } from "./config.ts";
import type { Workflow, WorkflowEvent, WorkflowRunState } from "./shared/api.ts";
import { realExec } from "./tools/index.ts";
import type { Exec } from "./types.ts";
import { createWorkflowRun, prepareWorkflowSkills } from "./workflow.ts";

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
export type { Exec, ExecResult, CommandConfig, Question } from "./types.ts";
export type { ServerConfig } from "./model.ts";
export type * from "./shared/api.ts";
export type * from "./shared/engine.ts";

export interface RunWorkflowOptions {
	onQuestion?: import("./types.ts").ToolContext["onQuestion"];
	protect?: string[];
	skills?: string[];
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
	let workflow = typeof options.workflow === "string"
		? JSON.parse(await readFile(options.workflow, "utf8")) as Workflow
		: structuredClone(options.workflow);
	workflow = await prepareWorkflowSkills(workflow, options.skills, async (id) => {
		if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid agent name.");
		return path.join(root, "agents", id);
	});
	workflow.vars = { ...workflow.vars, ...options.vars };
	workflow.protect = [...(workflow.protect ?? []), ...(options.protect ?? [])];
	const workspace = path.resolve(options.folder);
	const exec = options.exec ?? realExec;
	const run = createWorkflowRun(randomUUID(), workflow, options.task, {
		onQuestion: options.onQuestion,
		workspace,
		exec,
		runAgent: async (step, task, signal, onLine, onQuestion, questionBudget) => {
			if (!/^[A-Za-z0-9_-]+$/.test(step.agent)) throw new Error("Invalid agent name.");
			const result = await runAgent({
				questionBudget,
				agentDir: path.join(root, "agents", step.agent), workspace, task,
				server: { ...server, model: step.model ?? options.model ?? server.model, temperature: step.temperature ?? server.temperature, extra: { ...server.extra, ...step.extra } },
				commands: config.commands, runsDir: path.join(root, "runs"), exec,
				onQuestion, skills: step.skills, signal, onStep: onLine, maxSeconds: step.maxSeconds ?? options.maxSeconds, fetchFn: options.fetchFn,
				protect: step.protect,
				overrides: { maxTurns: step.maxTurns, tools: step.tools },
			});
			if (result.finalText) onLine(result.finalText);
			if (result.reason === "time") onLine("Ended: time");
			return { ok: result.reason === "done", text: result.finalText || result.error || `The agent ended with: ${result.reason}.`, limit: result.reason === "time" ? "time" : result.reason === "limit" ? "turns" : undefined };
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
