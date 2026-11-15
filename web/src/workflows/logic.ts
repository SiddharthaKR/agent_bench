import type { AgentStep, StepRun, StepRunStatus, Workflow, WorkflowEvent, WorkflowRunState, WorkflowStep } from "../../../src/shared/api.ts";

export interface RunView {
	id: string;
	workflow: Workflow;
	folder: string;
	state?: WorkflowRunState;
	lines: Record<string, string>;
	lastCommand?: { name: string; result: StepRun };
}

export function applyRunEvent(prior: RunView, event: WorkflowEvent): RunView {
	if (event.type === "line") return { ...prior, lines: { ...prior.lines, [event.stepId]: event.text } };
	let lastCommand = prior.lastCommand;
	const lines = { ...prior.lines };
	for (const result of event.state.steps) {
		const before = prior.state?.steps.find((item) => item.stepId === result.stepId);
		if (result.status === "running" && (before?.status !== "running" || before.round !== result.round)) delete lines[result.stepId];
		if (result.status !== "passed" && result.status !== "failed") continue;
		const step = prior.workflow.steps.find((item) => item.id === result.stepId);
		if (step?.type === "command" && (!before || before.status !== result.status || before.round !== result.round || before.text !== result.text || before.ms !== result.ms)) lastCommand = { name: step.name, result };
	}
	return { ...prior, state: event.state, lines, lastCommand };
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
		if (step) counts[step.type]++;
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
		case "running": return { text: `Running step ${n} of ${steps.length}, round ${state.round}`, tone: "warn" };
		case "paused": return { text: `Paused before step ${n}`, tone: "tint" };
		case "done": return { text: `Finished in ${state.round} round(s)`, tone: "ok" };
		case "failed": return { text: "Stopped, a step failed", tone: "bad" };
		case "stopped": return { text: "Stopped by you", tone: "bad" };
		default: return { text: "Ready", tone: "" };
	}
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
