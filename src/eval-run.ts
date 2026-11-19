/**
 * A VerilogEval run inside the app: one workflow, run on each chosen problem in turn,
 * each in a fresh folder holding only spec.md. Judge steps score the design against the
 * hidden test in a folder the agent never sees; raw steps ask the model once with the
 * benchmark's own prompt. Events stream live, like a single workflow run.
 */
import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvalEvent, EvalRunState, JudgeStep, RawStep, Workflow, WorkflowEvent } from "./shared/api.ts";
import type { WorkflowRun } from "./shared/engine.ts";
import type { ServerConfig } from "./model.ts";
import type { CommandConfig } from "./types.ts";
import { fillPlaceholders } from "./workflow.ts";
import { dataset, ensureSplits, judge, problemNames, task } from "../scripts/verilog_eval_report.mjs";
import { extractCode, requestReply } from "../scripts/verilog_eval_raw.mjs";

export interface EvalRun {
	readonly id: string;
	readonly events: readonly EvalEvent[];
	subscribe(listener: (event: EvalEvent) => void): () => void;
	start(): void;
	stop(): void;
}

export interface EvalRunDeps {
	runsDir: string;
	server: ServerConfig;
	serverId: string;
	commands: CommandConfig;
	/** Creates the workflow run for one problem folder, with judge and raw steps wired in. */
	makeRun(workspace: string, workflow: Workflow, taskText: string, runSpecial: (step: JudgeStep | RawStep, vars: Record<string, string>, signal: AbortSignal) => Promise<{ ok: boolean; text: string }>): Promise<WorkflowRun>;
	/** Overridable for tests. */
	judgeFn?: typeof judge;
	askRaw?: (server: ServerConfig, prompt: string, seconds: number, folder: string) => Promise<{ text: string; error?: string }>;
	now?: () => Date;
}

/** Problem names in the dev and held-out splits. Throws when the benchmark is missing. */
export function evalProblems(): { dev: string[]; heldout: string[] } {
	return ensureSplits(problemNames());
}

/** The task the agent gets, the same text the scoring script uses. */
export const evalTask = task;

function folderStamp(date: Date): string {
	return date.toISOString().replace(/[:.]/g, "-");
}

export function createEvalRun(id: string, workflow: Workflow, problems: string[], repeats: number, deps: EvalRunDeps): EvalRun {
	const known = new Set(problemNames());
	const unknown = problems.filter((name) => !known.has(name));
	if (!problems.length) throw new Error("Choose at least one problem.");
	if (unknown.length) throw new Error(`Unknown problems: ${unknown.slice(0, 5).join(", ")}.`);
	if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error("Repeats must be a whole number from 1 to 10.");
	const split = ensureSplits([...known]);
	const now = deps.now ?? (() => new Date());
	const folder = path.join(deps.runsDir, "verilog-eval-app", folderStamp(now()));
	const judges = workflow.steps.filter((step): step is JudgeStep => step.type === "judge").map((step) => ({ id: step.id, name: step.name }));
	const state: EvalRunState = {
		status: "running", folder, judges,
		problems: problems.flatMap((problem) => Array.from({ length: repeats }, (_, i) => ({ key: repeats > 1 ? `${problem} #${i + 1}` : problem, problem, attempt: i + 1, status: "waiting" as const, verdicts: {}, seconds: 0 }))),
	};
	const events: EvalEvent[] = [];
	const listeners = new Set<(event: EvalEvent) => void>();
	let stopped = false;
	let current: WorkflowRun | undefined;
	const judgeFn = deps.judgeFn ?? judge;
	const askRaw = deps.askRaw ?? (async (server, prompt, seconds, where) => {
		const result = await requestReply(server, prompt, seconds, where);
		return { text: result.reply.text, error: result.error ?? (result.timedOut ? `No reply within ${seconds} s.` : undefined) };
	});

	function emit(event: EvalEvent): void {
		events.push(structuredClone(event));
		for (const listener of [...listeners]) {
			try { listener(structuredClone(event)); } catch { /* A listener cannot stop the run. */ }
		}
	}
	const emitState = () => emit({ type: "eval", state });

	async function runProblem(index: number): Promise<void> {
		const entry = state.problems[index]!;
		const base = path.join(folder, entry.problem, ...(repeats > 1 ? [`run-${entry.attempt}`] : []));
		// The agent works in work/; judge folders sit beside it, out of the agent's reach.
		const workspace = path.join(base, "work");
		await mkdir(path.join(workspace, "rtl"), { recursive: true });
		await copyFile(path.join(dataset, `${entry.problem}_prompt.txt`), path.join(workspace, "spec.md"));
		const prompt = await readFile(path.join(workspace, "spec.md"), "utf8");
		const started = Date.now();
		entry.status = "running";
		emitState();
		const runSpecial = async (step: JudgeStep | RawStep, vars: Record<string, string>): Promise<{ ok: boolean; text: string }> => {
			const file = path.resolve(workspace, fillPlaceholders(step.file ?? "{design}", vars));
			if (path.relative(workspace, file).startsWith("..")) return { ok: false, text: "The file must be inside the problem folder." };
			if (step.type === "judge") {
				const verdict = judgeFn(file, path.join(dataset, `${entry.problem}_test.sv`), path.join(dataset, `${entry.problem}_ref.sv`), path.join(base, `judge-${step.id}`), deps.commands as unknown as Record<string, string[] | undefined>);
				entry.verdicts[step.id] = verdict;
				emitState();
				return { ok: verdict === "PASS", text: verdict };
			}
			const where = path.join(base, `raw-${step.id}`);
			await mkdir(where, { recursive: true });
			const server = step.model ? { ...deps.server, model: step.model } : deps.server;
			const reply = await askRaw(server, prompt, step.maxSeconds ?? 120, where);
			const code = extractCode(reply.text);
			if (code) {
				await mkdir(path.dirname(file), { recursive: true });
				await writeFile(file, code);
			}
			const head = reply.text.split(/\r?\n/).slice(0, 8).join("\n");
			return { ok: !!code, text: [reply.error, code ? `Wrote ${path.relative(workspace, file).replace(/\\/g, "/")}.` : "No code found in the reply; nothing written.", head].filter(Boolean).join("\n") };
		};
		const vars = { design: "rtl/TopModule.sv", tb: "tb/tb_top.sv" };
		const wired: Workflow = { ...workflow, vars: { ...workflow.vars, ...vars }, protect: [...(workflow.protect ?? []), "spec.md"] };
		const run = await deps.makeRun(workspace, wired, evalTask, runSpecial);
		current = run;
		await new Promise<void>((resolve) => {
			const finish = (event: WorkflowEvent) => {
				if (event.type === "state" && ["done", "failed", "stopped"].includes(event.state.status)) resolve();
			};
			run.subscribe((event) => {
				emit({ type: "problem", key: entry.key, event });
				finish(event);
			});
			run.start();
			for (const event of run.events) finish(event);
		});
		current = undefined;
		entry.seconds = (Date.now() - started) / 1000;
		// A judge that never ran (the run stopped or failed before it) gives no verdict.
		entry.status = stopped ? "stopped" : "done";
		emitState();
		if (stopped) return;
		const model = deps.server.model;
		for (const judgeStep of judges) {
			const verdict = entry.verdicts[judgeStep.id];
			if (!verdict) continue;
			const row = { when: now().toISOString(), suite: "verilog-eval", level: split.dev.includes(entry.problem) ? "dev" : "heldout", task: entry.problem, server: deps.serverId, model, setup: `app ${workflow.id} / ${judgeStep.name}`, pass: verdict === "PASS", verdict, toolCalls: null, seconds: entry.seconds, trace: workspace, source: "app", workflow: workflow.id, judge: judgeStep.name, attempt: entry.attempt };
			await appendFile(path.join(deps.runsDir, "results.jsonl"), `${JSON.stringify(row)}\n`);
		}
	}

	async function runAll(): Promise<void> {
		try {
			await mkdir(folder, { recursive: true });
			for (let i = 0; i < state.problems.length && !stopped; i++) await runProblem(i);
			for (const entry of state.problems) if (entry.status === "waiting") entry.status = "stopped";
			state.status = stopped ? "stopped" : "done";
		} catch (error) {
			state.status = "failed";
			state.error = error instanceof Error ? error.message : String(error);
		}
		await writeFile(path.join(folder, "summary.json"), `${JSON.stringify({ workflow: workflow.id, server: deps.serverId, model: deps.server.model, repeats, judges, problems: state.problems }, null, "\t")}\n`).catch(() => {});
		emitState();
	}

	return {
		id,
		get events() { return structuredClone(events); },
		subscribe(listener) {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		start() {
			emitState();
			void runAll();
		},
		stop() {
			if (state.status !== "running") return;
			stopped = true;
			current?.stop();
		},
	};
}
