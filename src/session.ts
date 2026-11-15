/**
 * One interactive chat with one agent: the Work screen's engine. The agent
 * keeps its conversation between messages, every tool call becomes an event
 * the screen can show, and edits can wait for the user's yes or no.
 */
import { createQuestionHandler } from "./tools/ask_user.ts";
import { createDeadline } from "./deadline.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { hasUnsavedCode, invalidTool, loadAgent, SAVE_REMINDER, toAgentTool } from "./agent.ts";
import { autofixVerilog } from "./tools/autofix.ts";
import { lineDiff } from "./diff.ts";
import { LoopGuard } from "./guard.ts";
import { trimContext } from "./context.ts";
import type { ProtectedContext } from "./tools/edit_policy.ts";
import { protectedRefusal, smallFileRefusal } from "./tools/edit_policy.ts";
import type { ServerConfig } from "./model.ts";
import { createStreamFn, makeModel } from "./model.ts";
import { INVALID_CALL, renderCall, renderToolHelp } from "./protocol.ts";
import { connectMcp } from "./mcp.ts";
import type { SessionEvent, StepStatus } from "./shared/api.ts";
import type { Session } from "./shared/engine.ts";
import { realExec, resolveInWorkspace } from "./tools/index.ts";
import { createTrace } from "./trace.ts";
import { createSubagentRunner } from "./subagent.ts";
import type { SubagentRunner } from "./subagent.ts";
import type { CommandConfig, Exec, ToolContext } from "./types.ts";

export interface SessionOptions {
	protect?: string[];
	id: string;
	agentDir: string;
	workspace: string;
	server: ServerConfig;
	commands: CommandConfig;
	runsDir: string;
	askFirst: boolean;
	exec?: Exec;
	fetchFn?: typeof fetch;
}

/** Tools that change a file. Their calls can wait for the user. */
const EDIT_TOOLS = new Set(["write_file", "replace_lines"]);

interface Preview {
	path: string;
	before: string;
	after: string;
	isNew: boolean;
}

/** Works out what an edit would do, without doing it. Null when the tool itself will report an error. */
async function previewEdit(tool: string, args: Record<string, unknown>, workspace: string): Promise<Preview | null> {
	const resolved = resolveInWorkspace(workspace, String(args.path ?? ""));
	if (!resolved.ok) return null;
	let before = "";
	let isNew = false;
	try {
		before = (await readFile(resolved.abs, "utf8")).replace(/\r\n/g, "\n");
	} catch {
		isNew = true;
	}
	const text = typeof args.content === "string" ? args.content.replace(/\r\n/g, "\n") : "";
	const repair = (value: string) => /\.(v|sv|vh|svh)$/i.test(resolved.rel) ? autofixVerilog(value).text : value;
	if (tool === "write_file") return { path: resolved.rel, before, after: repair(text), isNew };
	if (isNew) return null;
	const lines = before.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	const from = Number(args.from);
	const to = Number(args.to);
	if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > lines.length) return null;
	const fresh = text === "" ? [] : text.replace(/\n$/, "").split("\n");
	lines.splice(from - 1, to - from + 1, ...fresh);
	return { path: resolved.rel, before, after: repair(lines.join("\n")), isNew: false };
}

/** Events with the same key are versions of one thing. Null: every event stands alone. */
function keyOf(event: SessionEvent): string | null {
	if ("id" in event) return `${event.type}:${event.id}`;
	if (event.type === "status" || event.type === "usage") return event.type;
	return null;
}

function targetOf(args: Record<string, unknown>): string {
	return String(args.path ?? args.files ?? args.agent ?? "");
}

export async function createSession(options: SessionOptions): Promise<Session> {
	let runSubagent: SubagentRunner;
	let { agentFile, specs, systemPrompt } = await loadAgent(options.agentDir, {
		runSubagent: (id, task, signal) => runSubagent(id, task, signal),
	});
	const mcp = agentFile.mcp?.some((server) => server.enabled) ? await connectMcp(agentFile.mcp, { cwd: options.agentDir, closeOnExit: true, reservedNames: [INVALID_CALL, ...specs.map((spec) => spec.name)] }) : undefined;
	const mcpNames = new Set(mcp?.tools.map((spec) => spec.name));
	try {
		if (mcp?.tools.length) {
			systemPrompt = systemPrompt.replace(renderToolHelp(specs), () => renderToolHelp([...specs, ...mcp.tools]));
			specs.push(...mcp.tools);
		}
		const ctx: ProtectedContext & { smallFileLines?: number } = { smallFileLines: agentFile.smallFileLines, protect: options.protect, workspace: path.resolve(options.workspace), exec: options.exec ?? realExec, commands: options.commands };
		const trace = createTrace(options.runsDir, `${path.basename(options.agentDir)}-session`);
		trace.write({ type: "run_start", agent: agentFile.name, model: options.server.model, workspace: ctx.workspace, promptChars: systemPrompt.length, systemPrompt });

		const events: SessionEvent[] = [];
		const listeners = new Set<(event: SessionEvent) => void>();
		let askFirst = options.askFirst;
		let busy = false;
		let guard = new LoopGuard({ maxCalls: agentFile.maxTurns ?? 40 });
		let counter = 0;
		let modelCalls = 0;
		const totals = { questions: 0, unanswered: 0 };
		let outputTokens = 0;
		let saved = false;
		let reminded = false;
		const canWrite = specs.some((spec) => EDIT_TOOLS.has(spec.name));
		/** Reasoning and notes of the reply that made the current tool call. */
		let thinking = "";
		const waiting = new Map<string, (accept: boolean) => void>();
		/** Why a call did not run, by tool call id. */
		const refused = new Map<string, StepStatus>();
		const steps = new Map<string, Extract<SessionEvent, { type: "step" }>>();
		const proposals = new Map<string, Extract<SessionEvent, { type: "proposal" }>>();

		const emit = (event: SessionEvent) => {
			// Live text is not kept: a browser that connects later only needs the results.
			if (event.type !== "stream") {
				// An update replaces the earlier event with the same key and keeps its place,
				// so the kept list is the current picture, not the whole history.
				const key = keyOf(event);
				const same = key === null ? -1 : events.findIndex((e) => keyOf(e) === key);
				if (same >= 0) events[same] = event;
				else events.push(event);
			}
			for (const listener of [...listeners]) {
				try {
					listener(event);
				} catch {
					// A broken listener must not stop the agent.
				}
			}
		};
		const nextId = (prefix: string) => `${prefix}${++counter}`;
		const note = (text: string, tone: "info" | "bad" = "info") => emit({ type: "note", id: nextId("n"), text, tone });
		for (const text of mcp?.problems ?? []) {
			trace.write({ type: "note", text });
			note(text, "bad");
		}
		let deadline: ReturnType<typeof createDeadline> | undefined;
		let pendingQuestion: { id: string; event: Extract<SessionEvent, { type: "question" }>; resolve: (text: string | undefined) => void } | undefined;
		const questions = createQuestionHandler({
			maxQuestions: agentFile.maxQuestions, trace,
			onWait: (waiting) => waiting ? deadline?.pause() : deadline?.resume(),
			onQuestion: (question) => new Promise((resolve) => {
				const id = nextId("q");
				const event: Extract<SessionEvent, { type: "question" }> = { type: "question", id, ...question, answer: null, pending: true };
				pendingQuestion = { id, event, resolve };
				emit({ type: "status", state: "waiting" });
				if (pendingQuestion?.id === id) emit(event);
			}),
		});
		ctx.onQuestion = async (question, signal) => {
			try { return await questions.ask(question, signal); }
			finally {
				if (pendingQuestion) finishAnswer(pendingQuestion.id, undefined);
				if (busy) emit({ type: "status", state: "working" });
			}
		};
		function finishAnswer(id: string, text: string | undefined): boolean {
			if (pendingQuestion?.id !== id) return false;
			const pending = pendingQuestion;
			pendingQuestion = undefined;
			emit({ ...pending.event, answer: text ?? null, pending: false });
			pending.resolve(text);
			return true;
		}
		runSubagent = createSubagentRunner({ ...options, task: "", onStep: (line) => note(line) }, trace,
			() => deadline?.remaining());

		const agent = new Agent({
			initialState: {
				systemPrompt,
				model: makeModel(options.server),
				tools: [...specs.map((spec) => toAgentTool(spec, ctx)), invalidTool],
			},
			streamFn: createStreamFn({
				server: options.server,
				tools: specs,
				trace,
				fetchFn: options.fetchFn,
				onDelta: (kind, delta) => emit({ type: "stream", kind, delta }),
			}),
			toolExecution: "sequential",
			transformContext: agentFile.trimContext === false ? undefined : async (messages) => trimContext(messages),
			afterToolCall: async ({ toolCall, args, result, isError }) => {
				const text = result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
				const hint = guard.noteResult({ name: toolCall.name, args: (args ?? {}) as Record<string, string | number> }, !isError, text);
				return hint ? { content: [{ type: "text", text: `${text}\n${hint}` }, ...result.content.filter((block) => block.type !== "text")] } : undefined;
			},
			beforeToolCall: async ({ toolCall, args }) => {
				const typed = (args ?? {}) as Record<string, string | number>;
				const verdict = guard.check({ name: toolCall.name, args: typed });
				if (!verdict.allow) {
					refused.set(toolCall.id, "blocked");
					trace.write({ type: "guard", tool: toolCall.name, reason: verdict.reason });
					return { block: true, reason: verdict.reason, terminate: verdict.stop };
				}
				if (mcpNames.has(toolCall.name)) return undefined;
				const refusal = protectedRefusal(toolCall.name, typed, ctx) ?? await smallFileRefusal(toolCall.name, typed, ctx.workspace, agentFile.smallFileLines);
				if (refusal) {
					refused.set(toolCall.id, "blocked");
					return { block: true, reason: refusal };
				}
				const delegation = toolCall.name === "ask_agent";
				if (delegation && !askFirst) return undefined;
				if (!delegation && !EDIT_TOOLS.has(toolCall.name)) return undefined;
				const preview = delegation
					? { path: `ask_agent: ${String(typed.agent ?? "")}`, before: "", after: String(typed.content ?? ""), isNew: true }
					: await previewEdit(toolCall.name, typed, ctx.workspace);
				if (!preview) return undefined;
				const proposal: Extract<SessionEvent, { type: "proposal" }> = {
					type: "proposal",
					id: toolCall.id,
					path: preview.path,
					isNew: preview.isNew,
					diff: lineDiff(preview.before, preview.after),
					state: askFirst ? "pending" : "accepted",
				};
				proposals.set(toolCall.id, proposal);
				emit(proposal);
				if (!askFirst) return undefined;

				const step = steps.get(toolCall.id);
				if (step) emit({ ...step, status: "waiting" });
				emit({ type: "status", state: "waiting" });
				const accepted = await new Promise<boolean>((resolve) => waiting.set(toolCall.id, resolve));
				waiting.delete(toolCall.id);
				emit({ ...proposal, state: accepted ? "accepted" : "rejected" });
				if (busy) emit({ type: "status", state: "working" });
				if (accepted) {
					if (step) emit({ ...step, status: "running" });
					return undefined;
				}
				refused.set(toolCall.id, "rejected");
				return { block: true, reason: "The user rejected this change. Do not repeat it. Ask what they want, or make a different change." };
			},
		});

		agent.subscribe((event) => {
			if (event.type === "message_end" && event.message.role === "assistant") {
				const message = event.message as AssistantMessage;
				modelCalls++;
				outputTokens += message.usage.output;
				emit({ type: "usage", modelCalls, contextTokens: message.usage.input, outputTokens });
				const reasoning = message.content.filter((b) => b.type === "thinking").map((b) => (b as { thinking: string }).thinking);
				const text = message.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
				const hasCall = message.content.some((b) => b.type === "toolCall");
				if (hasCall) {
					thinking = [...reasoning, ...text].join("\n\n").trim();
				} else if (message.stopReason === "error") {
					note(message.errorMessage ?? "The model server reported an error.", "bad");
				} else if (message.stopReason !== "aborted") {
					if (canWrite && !saved && !reminded && hasUnsavedCode(message)) {
						reminded = true;
						trace.write({ type: "guard", reason: SAVE_REMINDER, stop: false });
						note(SAVE_REMINDER);
						agent.followUp({ role: "user", content: SAVE_REMINDER, timestamp: Date.now() });
						return;
					}
					const answer = text.join("\n").trim();
					if (answer) emit({ type: "agent", id: nextId("a"), text: answer });
				}
			} else if (event.type === "tool_execution_start") {
				const args = (event.args ?? {}) as Record<string, unknown>;
				const invalid = event.toolName === INVALID_CALL;
				const { content, ...plain } = args;
				const call = invalid
					? String(args.raw ?? "")
					: renderCall({
							name: event.toolName,
							args: Object.fromEntries(Object.entries(plain).map(([key, value]) => [key, String(value)])),
							...(typeof content === "string" ? { body: content } : {}),
						});
				const step: Extract<SessionEvent, { type: "step" }> = {
					type: "step",
					id: event.toolCallId,
					tool: invalid ? "unreadable call" : event.toolName,
					target: invalid ? "" : targetOf(args),
					status: "running",
					thinking,
					call,
					result: "",
				};
				steps.set(event.toolCallId, step);
				emit(step);
			} else if (event.type === "tool_execution_end") {
				const result: string = event.result?.content?.[0]?.text ?? "";
				const step = steps.get(event.toolCallId);
				const status: StepStatus = refused.get(event.toolCallId) ?? (event.isError ? "error" : "ok");
				if (status === "ok" && EDIT_TOOLS.has(event.toolName)) saved = true;
				trace.write({ type: "tool_result", tool: event.toolName, ok: !event.isError, ms: event.durationMs ?? 0, text: result });
				if (step) emit({ ...step, status, result, ...(event.durationMs !== undefined ? { ms: Math.round(event.durationMs) } : {}) });
				const proposal = proposals.get(event.toolCallId);
				if (status === "ok" && proposal && EDIT_TOOLS.has(event.toolName)) emit({ type: "file", path: proposal.path });
			}
		});

		const run = async (text: string) => {
			busy = true;
			saved = false;
			reminded = false;
			questions.reset();
			guard = new LoopGuard({ maxCalls: agentFile.maxTurns ?? 40 });
			emit({ type: "status", state: "working" });
			deadline = createDeadline(agentFile.maxSeconds, () => {
				for (const resolve of waiting.values()) resolve(false);
				agent.abort();
				note(`Ended: time (limit ${agentFile.maxSeconds} s)`);
			});
			deadline.resume();
			try {
				await agent.prompt(text);
			} catch (error) {
				note((error as Error).message, "bad");
			} finally {
				deadline?.close();
				trace.write({ type: "run_end", ...questions.counts() });
				totals.questions += questions.counts().questions;
				totals.unanswered += questions.counts().unanswered;
				trace.updateSummary?.({ agent: agentFile.name, model: options.server.model, task: text, modelCalls, outputTokens, ...totals });
			}
			busy = false;
			if (guard.blocked > 0 && guard.allowed >= (agentFile.maxTurns ?? 40)) note(`Stopped after ${guard.allowed} tool calls. Tell the agent how to continue.`, "bad");
			emit({ type: "status", state: "idle" });
		};

		emit({ type: "status", state: "idle" });

		return {
			id: options.id,
			get events() {
				return events;
			},
			subscribe(listener) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			send(text) {
				const trimmed = text.trim();
				if (!trimmed) return;
				emit({ type: "user", id: nextId("u"), text: trimmed });
				if (pendingQuestion) { finishAnswer(pendingQuestion.id, trimmed); return; }
				// While the agent works, a message steers it: it is read after the current tool call.
				if (busy) agent.steer({ role: "user", content: trimmed, timestamp: Date.now() });
				else void run(trimmed);
			},
			answer(id: string, text: string) {
				return !!text.trim() && finishAnswer(id, text.trim());
			},
			stop() {
				if (!busy) return;
				if (pendingQuestion) finishAnswer(pendingQuestion.id, undefined);
				for (const resolve of [...waiting.values()]) resolve(false);
				agent.abort();
				note("Stopped by you.");
			},
			resolve(proposalId, accept) {
				waiting.get(proposalId)?.(accept);
			},
			setAskFirst(value) {
				askFirst = value;
			},
		};
	} catch (error) {
		await mcp?.close();
		throw error;
	}
}
