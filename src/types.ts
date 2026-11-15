/**
 * Shared interfaces for the engine. Every module codes against these and
 * nothing else, so modules can be built and tested on their own.
 */

// ---------- Tools ----------

export type ArgType = "string" | "number";

/** One named argument of a tool, written by the model as a `key: value` line. */
export interface ArgSpec {
	name: string;
	type: ArgType;
	required: boolean;
	/** One short phrase shown to the model. */
	help: string;
}

export interface ToolOutput {
	ok: boolean;
	/** Short text sent back to the model. Keep it small: it costs context. */
	text: string;
}

export interface ExecResult {
	/** Exit code, or null when the process was killed. */
	code: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	/** True when the program itself could not be found on this machine. */
	notFound: boolean;
}

/** Runs a program without a shell. Injected so tests can fake it. */
export type Exec = (
	command: string,
	args: string[],
	options: { cwd: string; timeoutMs: number; signal?: AbortSignal },
) => Promise<ExecResult>;

/**
 * Command templates, one array entry per argument.
 * `{files}` expands to one argument per file; `{out}` is the build output path.
 */
export interface CommandConfig {
	compile: string[];
	simulate: string[];
}

export interface ToolContext {
	onQuestion?: (question: Question, signal?: AbortSignal) => Promise<string | undefined>;
	/** Absolute path of the project folder. Tools must never touch files outside it. */
	workspace: string;
	exec: Exec;
	commands: CommandConfig;
	signal?: AbortSignal;
}

export interface Question {
	question: string;
	assumption?: string;
}

export interface ToolSpec {
	name: string;
	/** One line shown to the model. */
	summary: string;
	args: ArgSpec[];
	/** Present when the tool takes a raw text body. The body arrives as `args.content`. */
	body?: { help: string };
	run(args: Record<string, string | number>, ctx: ToolContext): Promise<ToolOutput>;
}

/** The part of a tool the prompt needs. */
export type ToolHelp = Pick<ToolSpec, "name" | "summary" | "args" | "body">;

// ---------- Tool-call text protocol ----------

export interface ParsedCall {
	name: string;
	/** Raw `key: value` pairs, values still text. */
	args: Record<string, string>;
	/** Raw text between `---` and `@end`, when present. */
	body?: string;
}

export type ParsedReply =
	/** No tool call: the model is finished and this is its answer. */
	| { kind: "final"; text: string }
	/** One tool call. `notes` is whatever the model wrote before it. */
	| { kind: "call"; notes: string; call: ParsedCall }
	/** The model tried to call a tool but the block could not be read. */
	| { kind: "malformed"; notes: string; problem: string };

// ---------- Loop guard ----------

export interface GuardCall {
	name: string;
	/** Typed arguments, with the body (if any) under `content`. */
	args: Record<string, string | number>;
}

export type GuardVerdict =
	| { allow: true }
	/** `stop` is true when the run should end instead of letting the model try again. */
	| { allow: false; reason: string; stop: boolean };

// ---------- Trace ----------

export interface TraceEvent {
	type: string;
	[key: string]: unknown;
}

export interface TraceWriter {
	/** Folder this run writes into. */
	readonly dir: string;
	write(event: TraceEvent): void;
	/** Writes summary.json and ends the trace. */
	close(summary: Record<string, unknown>): void;
	/** Refreshes a session summary while keeping its trace open. */
	updateSummary?(summary: Record<string, unknown>): void;
}
