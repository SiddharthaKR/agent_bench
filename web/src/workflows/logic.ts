import type { AgentStep, EvalRunState, StepRun, StepRunStatus, Workflow, WorkflowEvent, WorkflowRunState, WorkflowStep } from "../../../src/shared/api.ts";

export interface RunView {
	question?: Extract<WorkflowEvent, { type: "question" }>;
	id: string;
	workflow: Workflow;
	folder: string;
	state?: WorkflowRunState;
	lines: Record<string, string>;
	lastCommand?: { name: string; result: StepRun };
}

export function applyRunEvent(prior: RunView, event: WorkflowEvent): RunView {
	if (event.type === "question") return { ...prior, question: event.answer === null && event.pending !== false ? event : undefined };
	if (event.type === "line") return { ...prior, lines: { ...prior.lines, [event.stepId]: event.text } };
	let lastCommand = prior.lastCommand;
	const lines = { ...prior.lines };
	for (const result of event.state.steps) {
		const before = prior.state?.steps.find((item) => item.stepId === result.stepId);
		if (result.status === "running" && (before?.status !== "running" || before.round !== result.round)) delete lines[result.stepId];
		if (result.status !== "passed" && result.status !== "failed") continue;
		const step = prior.workflow.steps.find((item) => item.id === result.stepId);
		if (step && step.type !== "agent" && (!before || before.status !== result.status || before.round !== result.round || before.text !== result.text || before.ms !== result.ms)) lastCommand = { name: step.name, result };
	}
	return { ...prior, state: event.state, lines, lastCommand, question: event.state.status === "waiting" ? prior.question : undefined };
}

export function parseCommand(text: string): string[] {
	const args: string[] = [];
	let word = "";
	let quoted = false;
	let started = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i]!;
		if (char === "\\" && (text[i + 1] === '"' || text[i + 1] === "\\")) {
			word += text[++i];
			started = true;
		} else if (char === '"') {
			quoted = !quoted;
			started = true;
		} else if (/\s/.test(char) && !quoted) {
			if (started) args.push(word);
			word = "";
			started = false;
		} else {
			word += char;
			started = true;
		}
	}
	if (started) args.push(word);
	return args;
}

export function commandToText(command: readonly string[]): string {
	return command.map((arg) => {
		const escaped = arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		return !arg || /[\s"]/.test(arg) ? `"${escaped}"` : escaped;
	}).join(" ");
}

export function nextId(prefix: string, ids: readonly string[]): string {
	let n = 1;
	while (ids.includes(`${prefix}-${n}`)) n++;
	return `${prefix}-${n}`;
}

export function removeStep(steps: readonly WorkflowStep[], id: string): WorkflowStep[] {
	return steps.filter((step) => step.id !== id).map((step) => {
		if (step.onFail?.goTo !== id) return step;
		const { onFail: _, ...rest } = step;
		return rest;
	});
}

export function countRuns(steps: readonly WorkflowStep[], results: readonly StepRun[]): { agent: number; command: number } {
	const counts = { agent: 0, command: 0 };
	for (const result of results) {
		if (result.status !== "passed" && result.status !== "failed") continue;
		const step = steps.find((item) => item.id === result.stepId);
		if (step?.type === "agent") counts.agent++;
		else if (step) counts.command++;
	}
	return counts;
}

export function stepStatus(status: StepRunStatus = "waiting"): { text: string; tone: string } {
	const words = { waiting: "Waiting", running: "Running", passed: "Passed", kept: "Kept", failed: "Failed" };
	return { text: words[status], tone: status === "running" ? "tone-warn" : status === "failed" ? "tone-bad" : status === "waiting" ? "muted" : "tone-ok" };
}

export function runStatus(state: WorkflowRunState | undefined, steps: readonly { id: string }[]): { text: string; tone: string } {
	const n = Math.max(1, steps.findIndex((step) => step.id === state?.current) + 1);
	switch (state?.status) {
		case "waiting": return { text: "Waiting for you", tone: "tint" };
		case "running": return { text: `Running step ${n} of ${steps.length}, round ${state.round}`, tone: "warn" };
		case "paused": return { text: `Paused before step ${n}`, tone: "tint" };
		case "done": return { text: `Finished in ${state.round} round(s)`, tone: "ok" };
		case "failed": return { text: "Stopped, a step failed", tone: "bad" };
		case "stopped": return { text: "Stopped by you", tone: "bad" };
		default: return { text: "Ready", tone: "" };
	}
}

/** Short word for a step's kind, for cards and the graph. */
export function stepKind(step: WorkflowStep): string {
	return { agent: "Agent", command: "Command", judge: "VerilogEval judge", raw: "Raw model" }[step.type];
}

/** The second line under a step's name. */
export function stepDetail(step: WorkflowStep): string {
	if (step.type === "agent") return step.agent;
	if (step.type === "command") return step.command[0] ? commandToText(step.command) : "No command";
	return step.file ?? "{design}";
}

/** A blank step of the given type that keeps the shared fields. A judge has no onFail. */
export function changeStepType(step: WorkflowStep, type: WorkflowStep["type"], agent: string): WorkflowStep {
	const { id, name, onFail, pause, once } = step;
	const base = { id, name, onFail, pause, once };
	if (type === "agent") return { ...base, type, agent, task: "" };
	if (type === "command") return { ...base, type, command: [], timeoutSec: 60 };
	if (type === "raw") return { ...base, type };
	return { id, name, pause, once, type };
}

export function setAgentSetting(step: AgentStep, key: "model" | "temperature" | "maxTurns", value: string): AgentStep {
	const next = { ...step };
	if (!value.trim()) delete next[key];
	else if (key === "model") next.model = value;
	else next[key] = Number(value);
	return next;
}

export function setStepTools(step: AgentStep, tools: string[]): AgentStep {
	const next = { ...step };
	if (tools.length) next.tools = tools;
	else delete next.tools;
	return next;
}

/** Problems a VerilogEval run covers for a choice in the picker. */
export function pickProblems(problems: { dev: string[]; heldout: string[] }, choice: "dev" | "heldout" | "all" | "pick", ticked: readonly string[]): string[] {
	if (choice === "dev") return [...problems.dev];
	if (choice === "heldout") return [...problems.heldout];
	const all = [...problems.dev, ...problems.heldout].sort();
	return choice === "all" ? all : all.filter((name) => ticked.includes(name));
}

/** Passes and judged problems per judge step. */
export function evalTotals(state: EvalRunState): { id: string; name: string; pass: number; judged: number }[] {
	return state.judges.map((judge) => {
		const verdicts = state.problems.map((item) => item.verdicts[judge.id]).filter((verdict): verdict is string => !!verdict);
		return { ...judge, pass: verdicts.filter((verdict) => verdict === "PASS").length, judged: verdicts.length };
	});
}
