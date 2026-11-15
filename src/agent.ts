/**
 * Runs one agent on one task: loads the agent folder, builds the prompt,
 * wires tools, loop guard and trace into pi-agent-core, and reports how it ended.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { LoopGuard } from "./guard.ts";
import { trimContext } from "./context.ts";
import { loadSkills, skillTool } from "./skills.ts";
import { createSubagentRunner, subagentTool } from "./subagent.ts";
import type { SubagentRunner } from "./subagent.ts";
import { smallFileRefusal } from "./tools/edit_policy.ts";
import type { ServerConfig } from "./model.ts";
import { createStreamFn, makeModel } from "./model.ts";
import { INVALID_CALL, renderToolHelp } from "./protocol.ts";
import { pickTools, realExec } from "./tools/index.ts";
import { createTrace } from "./trace.ts";
import { connectMcp } from "./mcp.ts";
import type { McpServer } from "./mcp.ts";
import type { CommandConfig, Exec, ToolContext, ToolSpec } from "./types.ts";

export interface AgentFile {
	name: string;
	tools: string[];
	maxTurns?: number;
	skills?: string[];
	smallFileLines?: number;
	trimContext?: boolean;
	maxSeconds?: number;
	subagents?: string[];
	mcp?: McpServer[];
}

export interface RunOptions {
	/** Folder holding agent.json and prompt.md. */
	agentDir: string;
	/** Project folder the agent works in. */
	workspace: string;
	task: string;
	server: ServerConfig;
	commands: CommandConfig;
	/** Folder where run traces are written. */
	runsDir: string;
	exec?: Exec;
	fetchFn?: typeof fetch;
	/** Called with one short line per step, for the console. */
	onStep?: (line: string) => void;
	signal?: AbortSignal;
	maxSeconds?: number;
	depth?: number;
	overrides?: { maxTurns?: number; tools?: string[] };
}

export interface LoadAgentOptions {
	depth?: number;
	overrides?: RunOptions["overrides"];
	runSubagent?: SubagentRunner;
}

export type EndReason = "done" | "loop" | "limit" | "error" | "aborted" | "time";

export interface RunResult {
	reason: EndReason;
	/** Last thing the model said. */
	finalText: string;
	error?: string;
	modelCalls: number;
	toolCalls: number;
	toolErrors: number;
	invalidCalls: number;
	blocked: number;
	/** Characters in the system prompt including the tool instructions. */
	promptChars: number;
	/** Prompt tokens of the first and of the last request, as reported by the server. */
	firstPromptTokens: number;
	lastPromptTokens: number;
	outputTokens: number;
	ms: number;
	traceDir: string;
}

const INVALID_HELP = "Write the call again in exactly this form:\n@tool name\nkey: value\n---\ntext (only if the tool takes it)\n@end";

export function toAgentTool(spec: ToolSpec, ctx: ToolContext): AgentTool {
	const props: Record<string, any> = {};
	for (const arg of spec.args) {
		const base = arg.type === "number" ? Type.Number() : Type.String();
		props[arg.name] = arg.required ? base : Type.Optional(base);
	}
	if (spec.body) props.content = Type.Optional(Type.String());
	return {
		name: spec.name,
		label: spec.name,
		description: spec.summary,
		parameters: Type.Object(props),
		execute: async (_id, params, signal) => {
			try {
				const out = await spec.run(params as Record<string, string | number>, { ...ctx, signal });
				return { content: [{ type: "text", text: out.text }], details: { ok: out.ok }, isError: !out.ok };
			} catch (error) {
				return { content: [{ type: "text", text: `${spec.name} crashed: ${(error as Error).message}` }], details: { ok: false }, isError: true };
			}
		},
	};
}

/** Stands in for a tool call the model wrote wrongly, so it gets a clear error and tries again. */
export const invalidTool: AgentTool = {
	name: INVALID_CALL,
	label: INVALID_CALL,
	description: "Internal: reports a tool call that could not be read.",
	parameters: Type.Object({ problem: Type.String(), raw: Type.String() }),
	execute: async (_id, params) => ({
		content: [{ type: "text", text: `${(params as { problem: string }).problem}\n${INVALID_HELP}` }],
		details: { ok: false },
		isError: true,
	}),
};

function short(text: string, max = 110): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Reads an agent folder and builds its system prompt. */
export async function loadAgent(agentDir: string, options: LoadAgentOptions = {}): Promise<{ agentFile: AgentFile; specs: ToolSpec[]; systemPrompt: string }> {
	const agentFile = JSON.parse(await readFile(path.join(agentDir, "agent.json"), "utf8")) as AgentFile;
	const prompt = (await readFile(path.join(agentDir, "prompt.md"), "utf8")).trim();
	const selected = options.overrides?.tools;
	for (const name of selected ?? []) {
		if (!agentFile.tools.includes(name)) throw new Error(`Tool "${name}" is not available to agent "${agentFile.name}".`);
	}
	const specs = pickTools(selected ?? agentFile.tools);
	const skills = await loadSkills(agentDir, agentFile.skills);
	const optional = skills.filter((skill) => !skill.always);
	if (optional.length && selected === undefined) specs.push(skillTool(optional));
	if (agentFile.subagents?.length && (options.depth ?? 0) === 0 && selected === undefined) {
		specs.push(await subagentTool(agentDir, agentFile.subagents, options.runSubagent));
	}
	const always = skills.filter((skill) => skill.always).map((skill) => `## ${skill.name}\n${skill.text}`);
	const listing = optional.length && selected === undefined ? `\n\nSkills you can load with use_skill:\n${optional.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")}` : "";
	return { agentFile, specs, systemPrompt: [prompt, ...always, renderToolHelp(specs)].join("\n\n") + listing };
}

export async function runAgent(options: RunOptions): Promise<RunResult> {
	const started = Date.now();
	let runSubagent: SubagentRunner;
	let { agentFile, specs, systemPrompt } = await loadAgent(options.agentDir, {
		depth: options.depth,
		overrides: options.overrides,
		runSubagent: (...args) => runSubagent(...args),
	});
	const mcp = agentFile.mcp?.some((server) => server.enabled) ? await connectMcp(agentFile.mcp, { cwd: options.agentDir, reservedNames: [INVALID_CALL, ...specs.map((spec) => spec.name)] }) : undefined;
	const mcpNames = new Set(mcp?.tools.map((spec) => spec.name));
	try {
		if (mcp?.tools.length) {
			systemPrompt = systemPrompt.replace(renderToolHelp(specs), () => renderToolHelp([...specs, ...mcp.tools]));
			specs.push(...mcp.tools);
		}

		const trace = createTrace(options.runsDir, path.basename(options.agentDir));
		for (const text of mcp?.problems ?? []) trace.write({ type: "note", text });
		const ctx: ToolContext = { workspace: path.resolve(options.workspace), exec: options.exec ?? realExec, commands: options.commands };
		const guard = new LoopGuard({ maxCalls: options.overrides?.maxTurns ?? agentFile.maxTurns ?? 40 });
		const seconds = options.maxSeconds ?? agentFile.maxSeconds;
		const remainingSeconds = () => seconds === undefined ? undefined : Math.max(0, seconds - (Date.now() - started) / 1000);
		runSubagent = createSubagentRunner(options, trace, remainingSeconds);

		let stoppedBy: EndReason | undefined;
		let modelCalls = 0;
		let toolCalls = 0;
		let toolErrors = 0;
		let invalidCalls = 0;
		let firstPromptTokens = 0;
		let lastPromptTokens = 0;
		let outputTokens = 0;
		const say = options.onStep ?? (() => {});

		trace.write({
			type: "run_start",
			agent: agentFile.name,
			model: options.server.model,
			server: options.server.baseUrl,
			workspace: ctx.workspace,
			task: options.task,
			tools: specs.map((spec) => spec.name),
			promptChars: systemPrompt.length,
			systemPrompt,
		});

		const agent = new Agent({
			initialState: {
				systemPrompt,
				model: makeModel(options.server),
				tools: [...specs.map((spec) => toAgentTool(spec, ctx)), invalidTool],
			},
			streamFn: createStreamFn({ server: options.server, tools: specs, trace, fetchFn: options.fetchFn }),
			toolExecution: "sequential",
			transformContext: agentFile.trimContext === false ? undefined : async (messages) => trimContext(messages),
			afterToolCall: async ({ toolCall, args, result, isError }) => {
				const text = result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
				const hint = guard.noteResult({ name: toolCall.name, args: (args ?? {}) as Record<string, string | number> }, !isError, text);
				return hint ? { content: [{ type: "text", text: `${text}\n${hint}` }, ...result.content.filter((block) => block.type !== "text")] } : undefined;
			},
			beforeToolCall: async ({ toolCall, args }) => {
				const verdict = guard.check({ name: toolCall.name, args: (args ?? {}) as Record<string, string | number> });
				if (verdict.allow) {
					if (mcpNames.has(toolCall.name)) return undefined;
					const refusal = await smallFileRefusal(toolCall.name, (args ?? {}) as Record<string, unknown>, ctx.workspace, agentFile.smallFileLines);
					return refusal ? { block: true, reason: refusal } : undefined;
				}
				trace.write({ type: "guard", tool: toolCall.name, reason: verdict.reason, stop: verdict.stop });
				say(`     guard: ${verdict.reason}`);
				if (verdict.stop) stoppedBy = verdict.reason.includes("limit") ? "limit" : "loop";
				return { block: true, reason: verdict.reason, terminate: verdict.stop };
			},
		});

		agent.subscribe((event) => {
			if (event.type === "message_end" && event.message.role === "assistant") {
				const message = event.message as AssistantMessage;
				modelCalls++;
				if (!firstPromptTokens) firstPromptTokens = message.usage.input;
				lastPromptTokens = message.usage.input || lastPromptTokens;
				outputTokens += message.usage.output;
			} else if (event.type === "tool_execution_start") {
				const { content, raw, ...rest } = (event.args ?? {}) as Record<string, unknown>;
				trace.write({
					type: "tool_call",
					tool: event.toolName,
					args: rest,
					...(typeof content === "string" ? { contentChars: content.length, content } : {}),
				});
			} else if (event.type === "tool_execution_end") {
				const text: string = event.result?.content?.[0]?.text ?? "";
				toolCalls++;
				if (event.toolName === INVALID_CALL) invalidCalls++;
				else if (event.isError) toolErrors++;
				trace.write({ type: "tool_result", tool: event.toolName, ok: !event.isError, ms: event.durationMs ?? 0, text });
				say(`${String(toolCalls).padStart(3)}. ${event.toolName} ${event.isError ? "✗" : "✓"} ${short(text)}`);
			}
		});

		const abort = () => agent.abort();
		options.signal?.addEventListener("abort", abort, { once: true });
		let timedOut = false;
		const timer = seconds !== undefined ? setTimeout(() => { timedOut = true; agent.abort(); }, remainingSeconds()! * 1000) : undefined;

		let error: string | undefined;
		try {
			if (!options.signal?.aborted) await agent.prompt(options.task);
		} catch (thrown) {
			error = (thrown as Error).message;
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", abort);
		}

		const replies = [...agent.state.messages].reverse().filter((m): m is AssistantMessage => m.role === "assistant");
		const last = replies[0];
		const finalText = replies.map((message) => message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim()).find(Boolean) ?? "";
		if (last?.stopReason === "error") error = last.errorMessage ?? "Model error";

		let reason: EndReason = "done";
		if (timedOut) { reason = "time"; error = undefined; }
		else if (options.signal?.aborted || last?.stopReason === "aborted") reason = "aborted";
		else if (error) reason = "error";
		else if (stoppedBy) reason = stoppedBy;

		const result: RunResult = {
			reason,
			finalText,
			...(error ? { error } : {}),
			modelCalls,
			toolCalls,
			toolErrors,
			invalidCalls,
			blocked: guard.blocked,
			promptChars: systemPrompt.length,
			firstPromptTokens,
			lastPromptTokens,
			outputTokens,
			ms: Date.now() - started,
			traceDir: trace.dir,
		};
		trace.write({ type: "run_end", ...result });
		trace.close({ ...result, agent: agentFile.name, model: options.server.model, task: options.task });
		return result;
	} finally { await mcp?.close(); }
}
