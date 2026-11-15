/**
 * Types shared by the engine, the local server and the browser app.
 * Types only: nothing here may import Node or browser code.
 */

// ---------- Files ----------

export interface TreeNode {
	name: string;
	/** Path from the project folder, forward slashes. */
	path: string;
	/** Present for folders, sorted folders first then by name. */
	children?: TreeNode[];
}

export interface DiffLine {
	kind: "same" | "add" | "del";
	text: string;
	/** Line number in the old file (same, del) or the new file (add). */
	line: number;
}

// ---------- App configuration ----------

export interface AgentInfo {
	/** Folder name under agents/. */
	id: string;
	name: string;
	tools: string[];
}

export interface ServerInfo {
	/** Key in config.json. */
	id: string;
	baseUrl: string;
	model: string;
}

export interface AppConfig {
	agents: AgentInfo[];
	servers: ServerInfo[];
	/** Folder the app was started in; the default project folder. */
	defaultFolder: string;
}

// ---------- Work screen: one chat session with one agent ----------

export type StepStatus = "running" | "ok" | "error" | "waiting" | "rejected" | "blocked";

/**
 * Everything the Work screen shows arrives as these events, in order.
 * Events with the same `type` and `id` update the earlier one (a step starts
 * as "running" and is sent again when it ends). A proposal has the same id as
 * the step it belongs to.
 */
export type SessionEvent =
	/** The agent started or stopped working, or waits for the user to accept a change. */
	| { type: "status"; state: "idle" | "working" | "waiting" }
	| { type: "user"; id: string; text: string }
	/** Live text while the model is writing its reply. `kind` thinking = its reasoning. */
	| { type: "stream"; kind: "thinking" | "text"; delta: string }
	/** One tool call. */
	| {
			type: "step";
			id: string;
			tool: string;
			/** Short subject, usually the file path. */
			target: string;
			status: StepStatus;
			/** What the model wrote before the call (its reasoning and notes). */
			thinking: string;
			/** The call as the model wrote it. */
			call: string;
			/** What the tool answered. Empty while running. */
			result: string;
			ms?: number;
	  }
	/** An edit that waits for the user. Answer with POST .../resolve. */
	| { type: "proposal"; id: string; path: string; isNew: boolean; diff: DiffLine[]; state: "pending" | "accepted" | "rejected" }
	/** The agent's message to the user. */
	| { type: "agent"; id: string; text: string }
	/** A line from the app itself: stopped, error, loop guard. */
	| { type: "note"; id: string; text: string; tone: "info" | "bad" }
	/** A file in the project changed (by the agent). */
	| { type: "file"; path: string }
	| { type: "usage"; modelCalls: number; contextTokens: number; outputTokens: number };

export interface CreateSessionRequest {
	protect?: string[];
	agent: string;
	folder: string;
	server: string;
	model?: string;
	askFirst: boolean;
}

export interface CreateSessionResponse {
	id: string;
}

// ---------- Workflows ----------

/** Where to go when a step fails, and how many rounds the whole run may take. */
export interface OnFail {
	/** Id of an earlier step. */
	goTo: string;
	maxRounds: number;
}

interface StepBase {
	id: string;
	name: string;
	onFail?: OnFail;
	/** Stop after this step until the user continues. */
	pause?: boolean;
	/** Run only in the first round; later rounds keep the result. */
	once?: boolean;
}

/** The model works on a task with a fresh context. */
export interface AgentStep extends StepBase {
	/** Skills preloaded into this step's system prompt. */
	skills?: string[];
	type: "agent";
	/** Folder name under agents/. */
	agent: string;
	/** May contain {task} and {name} placeholders for workflow variables. */
	task: string;
	/** Settings for this step only. Each one falls back to the agent's or the server's own value. */
	model?: string;
	temperature?: number;
	/** Most tool calls this step may make. */
	maxTurns?: number;
	/** Time limit for this step, in seconds. */
	maxSeconds?: number;
	/** Extra request fields for this step, merged over the server's own `extra`. */
	extra?: Record<string, unknown>;
	/** Settings used instead when this step runs again after a failed check. */
	retry?: { skills?: string[]; model?: string; temperature?: number; maxTurns?: number; maxSeconds?: number; extra?: Record<string, unknown> };
	/** Tool names this step may use; a subset of the agent's tools. */
	tools?: string[];
}

/** A program runs; no model. Passes on exit code 0 with no failure line in its output. */
export interface CommandStep extends StepBase {
	type: "command";
	/** Program and arguments. May contain {name} placeholders. Runs in the project folder. */
	command: string[];
	timeoutSec?: number;
}

export type WorkflowStep = AgentStep | CommandStep;

export interface Workflow {
	protect?: string[];
	id: string;
	name: string;
	/** Default task text shown in the run box. */
	task: string;
	/** Values for {name} placeholders, e.g. file paths. */
	vars: Record<string, string>;
	steps: WorkflowStep[];
}

export type RunStatus = "idle" | "running" | "paused" | "done" | "failed" | "stopped";
export type StepRunStatus = "waiting" | "running" | "passed" | "failed" | "kept";

export interface StepRun {
	stepId: string;
	status: StepRunStatus;
	/** Round in which this result was produced. */
	round: number;
	/** Short result: the agent's last message, or the end of the command output. */
	text: string;
	ms: number;
}

export interface WorkflowRunState {
	status: RunStatus;
	round: number;
	/** Id of the step that is running or comes next; null when finished. */
	current: string | null;
	steps: StepRun[];
	/** One line per loop back, pause, stop and finished round. */
	log: string[];
}

export type WorkflowEvent =
	/** The whole state, sent after every change. Simple and always consistent. */
	| { type: "state"; state: WorkflowRunState }
	/** A progress line from the step that is running (a tool call of an agent step). */
	| { type: "line"; stepId: string; text: string };

export interface RunWorkflowRequest {
	/** Skills added to every agent step, including retries. */
	skills?: string[];
	/** The workflow as currently edited in the browser. */
	workflow: Workflow;
	folder: string;
	server: string;
	model?: string;
	task: string;
}

export interface RunWorkflowResponse {
	id: string;
}
