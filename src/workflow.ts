import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentStep, CommandStep, Workflow, WorkflowEvent, WorkflowRunState } from "./shared/api.ts";
import type { WorkflowRun } from "./shared/engine.ts";
import type { Exec } from "./types.ts";
import { simHints } from "./tools/sim_hints.ts";
import { loadSkills, validateSkillNames } from "./skills.ts";

/** Validate all selections before any step runs, and apply run-wide additions. */
export async function prepareWorkflowSkills(workflow: Workflow, names: string[] | undefined, agentDirOf: (id: string) => Promise<string>): Promise<Workflow> {
	const prepared = structuredClone(workflow);
	for (const step of prepared.steps) {
		if (step.type !== "agent") continue;
		if (names?.length) {
			const first = step.skills;
			step.skills = [...new Set([...(first ?? []), ...names])];
			if (step.retry) step.retry.skills = [...new Set([...(step.retry.skills ?? first ?? []), ...names])];
		}
		const selected = [...(step.skills ?? []), ...(step.retry?.skills ?? [])];
		if (!selected.length) continue;
		const dir = await agentDirOf(step.agent);
		const agent = JSON.parse(await readFile(join(dir, "agent.json"), "utf8")) as { name: string; skills?: string[] };
		validateSkillNames(await loadSkills(dir), selected, agent.name);
	}
	return prepared;
}

export interface WorkflowDeps {
	/** Absolute project folder used by commands. */
	workspace: string;
	exec: Exec;
	/** Runs an agent with fresh context and reports one line per tool call. */
	runAgent(step: AgentStep, task: string, signal: AbortSignal, onLine: (line: string) => void): Promise<{ ok: boolean; text: string; limit?: "time" | "turns" }>;
}

export function fillPlaceholders(text: string, vars: Record<string, string>): string {
	return text.replace(/\{([^{}]+)\}/g, (match: string, name: string) => Object.hasOwn(vars, name) ? vars[name]! : match);
}

export function validateWorkflow(workflow: Workflow): string[] {
	const problems: string[] = [];
	const seen = new Set<string>();
	if (workflow.steps.length === 0) problems.push("The workflow has no steps.");
	for (const step of workflow.steps) {
		if (seen.has(step.id)) problems.push(`Step id "${step.id}" is duplicated.`);
		seen.add(step.id);
		if (!step.name.trim()) problems.push(`Step "${step.id}" needs a name.`);
		if (step.type === "agent") {
			if (!step.agent.trim()) problems.push(`Step "${step.id}" needs an agent.`);
			if (!step.task.trim()) problems.push(`Step "${step.id}" needs a task.`);
			for (const settings of [step, step.retry]) {
				if (!settings) continue;
				if (settings.temperature !== undefined && (!Number.isFinite(settings.temperature) || settings.temperature < 0 || settings.temperature > 2)) problems.push(`Step "${step.id}" needs a temperature between 0 and 2.`);
				if (settings.maxTurns !== undefined && (!Number.isInteger(settings.maxTurns) || settings.maxTurns < 1)) problems.push(`Step "${step.id}" needs at least one turn.`);
				if (settings.maxSeconds !== undefined && (!Number.isFinite(settings.maxSeconds) || settings.maxSeconds <= 0)) problems.push(`Step "${step.id}" needs a positive time limit.`);
			}
			if (step.tools !== undefined && step.tools.length === 0) problems.push(`Step "${step.id}" needs at least one tool.`);
		} else if (!step.command.length || !step.command[0]?.trim()) {
			problems.push(`Step "${step.id}" needs a command.`);
		}
		if (step.onFail) {
			if (!seen.has(step.onFail.goTo)) problems.push(`Step "${step.id}" must go back to itself or an earlier step.`);
			if (step.onFail.maxRounds < 1) problems.push(`Step "${step.id}" needs at least one round.`);
		}
	}
	return problems;
}

async function runCommand(step: CommandStep, vars: Record<string, string>, deps: WorkflowDeps, signal: AbortSignal): Promise<{ ok: boolean; text: string }> {
	const [program = "", ...args] = step.command.map((part) => fillPlaceholders(part, vars));
	const seconds = step.timeoutSec ?? 120;
	const output = await deps.exec(program, args, { cwd: deps.workspace, timeoutMs: seconds * 1000, signal });
	if (output.notFound) return { ok: false, text: `The program "${program}" is not installed on this machine.` };
	if (output.timedOut) return { ok: false, text: `Timed out after ${seconds} s.` };
	const lines = [output.stdout, output.stderr].flatMap((text) => text.split(/\r?\n/)).map((line) => line.trim()).filter(Boolean);
	const failures = lines.filter((line) => /\b(?:FAIL|FAILED|ERROR|MISMATCH)\b/i.test(line));
	const ok = output.code === 0 && failures.length === 0;
	const selected = ok ? lines.slice(-5) : failures.length ? failures.slice(0, 10) : lines.slice(-10);
	let text = selected.map((line) => line.slice(0, 200)).join("\n");
	if (!ok && lines.length > selected.length) text += `\n(${lines.length - selected.length} more lines not shown)`;
	if (!ok) text = [text, ...simHints(failures)].join("\n");
	if (ok && !text) text = "Finished with no output.";
	return { ok, text };
}

export function createWorkflowRun(id: string, workflow: Workflow, task: string, deps: WorkflowDeps): WorkflowRun {
	workflow = structuredClone(workflow);
	const vars = { ...workflow.vars, task };
	const state: WorkflowRunState = { status: "idle", round: 0, current: null, steps: [], log: [] };
	const events: WorkflowEvent[] = [];
	const listeners = new Set<(event: WorkflowEvent) => void>();
	const passed = new Map<string, number>();
	const lastAgent = new Map<number, string>();
	const attempts: string[] = [];
	const agentRuns = new Map<string, number>();
	let failure: { name: string; text: string; round: number } | undefined;
	let controller = new AbortController();
	let buildCreated = false;

	function emit(event: WorkflowEvent): void {
		events.push(structuredClone(event));
		for (const listener of [...listeners]) {
			try { listener(structuredClone(event)); } catch { /* Listeners cannot interrupt work. */ }
		}
	}
	const emitState = (): void => emit({ type: "state", state });
	const active = (owner: AbortController): boolean => owner === controller && !owner.signal.aborted && state.status === "running";
	const waiting = (index: number): void => {
		for (let i = index; i < workflow.steps.length; i++) {
			const step = workflow.steps[i]!;
			if (!(step.once && passed.has(step.id))) state.steps[i] = { stepId: step.id, status: "waiting", round: state.round, text: "", ms: 0 };
		}
	};

	async function loop(index: number, owner: AbortController): Promise<void> {
		const first = index;
		while (index < workflow.steps.length && active(owner)) {
			const step = workflow.steps[index]!;
			state.current = step.id;
			state.steps[index] = { stepId: step.id, status: "running", round: state.round, text: "", ms: 0 };
			emitState();
			if (!active(owner)) return;
			const previousRound = passed.get(step.id);
			// A run-once step is kept in later rounds, and on a resume unless the user resumed from that very step.
			if (step.once && previousRound !== undefined && (previousRound < state.round || index !== first)) {
				state.steps[index] = { stepId: step.id, status: "kept", round: state.round, text: `Kept from round ${previousRound}.`, ms: 0 };
				emitState();
				index++;
				continue;
			}
			const started = Date.now();
			let outcome: { ok: boolean; text: string };
			try {
				if (step.type === "agent") {
					let taskText = fillPlaceholders(step.task, vars);
					if (failure) taskText += `\n\nThe check "${failure.name}" failed in round ${failure.round}:\n${failure.text}\n\nEarlier attempts:\n${attempts.join("\n")}\nFix the problem.`;
					const count = agentRuns.get(step.id) ?? 0;
					agentRuns.set(step.id, count + 1);
					const settings = count > 0 && step.retry ? { ...step, ...step.retry, extra: { ...step.extra, ...step.retry.extra } } : step;
					const result = await deps.runAgent(settings, taskText, owner.signal, (text) => {
						if (active(owner)) emit({ type: "line", stepId: step.id, text });
					});
					if (!active(owner)) return;
					const checksDecide = result.limit !== undefined && workflow.steps.slice(index + 1).some((next) => next.type === "command");
					if (checksDecide) {
						const text = "Stopped at the time limit; the checks decide.";
						state.log.push(text);
						emit({ type: "line", stepId: step.id, text });
					}
					outcome = { ok: result.ok || checksDecide, text: result.text };
					lastAgent.set(state.round, (outcome.text.split(/\r?\n/)[0] ?? "").slice(0, 160));
					outcome = { ok: outcome.ok, text: outcome.text.slice(0, 600) };
				} else {
					if (!buildCreated) {
						await mkdir(join(deps.workspace, ".build"), { recursive: true }).catch(() => {});
						if (!active(owner)) return;
						buildCreated = true;
					}
					outcome = await runCommand(step, vars, deps, owner.signal);
				}
			} catch (error) {
				outcome = { ok: false, text: error instanceof Error ? error.message : String(error) };
			}
			if (!active(owner)) return;
			state.steps[index] = { stepId: step.id, status: outcome.ok ? "passed" : "failed", round: state.round, text: outcome.text, ms: Date.now() - started };
			if (outcome.ok) {
				passed.set(step.id, state.round);
				// Once the failed check passes, later agent steps no longer need its report.
				if (failure?.name === step.name) failure = undefined;
			}
			emitState();
			if (!active(owner)) return;
			if (outcome.ok) {
				if (step.pause && index < workflow.steps.length - 1) {
					state.status = "paused";
					state.current = workflow.steps[index + 1]!.id;
					state.log.push(`Paused after step ${index + 1}, ${step.name}.`);
					emitState();
					return;
				}
				index++;
			} else {
				const target = workflow.steps.findIndex((candidate) => candidate.id === step.onFail?.goTo);
				if (step.onFail && target >= 0 && target <= index && state.round < step.onFail.maxRounds) {
					state.log.push(`Round ${state.round}: step ${index + 1}, ${step.name}, failed. Going back to step ${target + 1}, ${workflow.steps[target]!.name}.`);
					failure = { name: step.name, text: outcome.text, round: state.round };
					attempts.push(`- round ${state.round}: ${lastAgent.get(state.round) ?? ""} -> ${step.name} failed`);
					state.round++;
					index = target;
					waiting(index);
					emitState();
				} else {
					state.status = "failed";
					state.log.push(`Round ${state.round}: step ${index + 1}, ${step.name}, failed. Stopped and waiting for you.`);
					emitState();
					return;
				}
			}
		}
		if (active(owner)) {
			state.status = "done";
			state.current = null;
			state.log.push(`Round ${state.round}: all steps passed.`);
			emitState();
		}
	}

	return {
		id,
		get state() { return structuredClone(state); },
		get events() { return structuredClone(events); },
		subscribe(listener) {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		start() {
			if (state.status === "running" || state.status === "paused") return;
			controller.abort();
			controller = new AbortController();
			passed.clear();
			agentRuns.clear();
			lastAgent.clear();
			attempts.length = 0;
			failure = undefined;
			state.steps = workflow.steps.map((step) => ({ stepId: step.id, status: "waiting", round: 1, text: "", ms: 0 }));
			state.log = [];
			const problems = validateWorkflow(workflow);
			state.round = problems.length ? 0 : 1;
			state.current = problems.length ? null : workflow.steps[0]!.id;
			state.status = problems.length ? "failed" : "running";
			state.log.push(...problems);
			const owner = controller;
			emitState();
			if (!problems.length) void loop(0, owner);
		},
		resume(fromStepId) {
			if (!["paused", "failed", "stopped"].includes(state.status)) return;
			let index = workflow.steps.findIndex((step) => step.id === fromStepId);
			if (index < 0) index = workflow.steps.findIndex((step) => step.id === state.current);
			if (index < 0 || validateWorkflow(workflow).length) return;
			controller = new AbortController();
			failure = undefined;
			state.status = "running";
			state.current = workflow.steps[index]!.id;
			waiting(index);
			const owner = controller;
			emitState();
			void loop(index, owner);
		},
		stop() {
			if (state.status !== "running" && state.status !== "paused") return;
			controller.abort();
			state.status = "stopped";
			for (const step of state.steps) if (step.status === "running") step.status = "waiting";
			state.log.push("Stopped by you.");
			emitState();
		},
	};
}
