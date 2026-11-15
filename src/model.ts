/**
 * Talks to an OpenAI-compatible server (LM Studio, Ollama) with plain chat
 * messages. No tool schema is sent: tools are described in the system prompt
 * and the model's tool call is read from its text (see protocol.ts). This is
 * the only place that knows both the wire format and the text protocol.
 */
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Message, Model, TextContent, ThinkingContent, ToolCall, Usage } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { INVALID_CALL, parseReply, renderCall, renderResult } from "./protocol.ts";
import type { ParsedCall, ToolHelp, TraceWriter } from "./types.ts";

export interface ServerConfig {
	baseUrl: string;
	model: string;
	/** Left unset unless configured, so the server's own default applies. */
	temperature?: number;
	apiKey?: string;
}

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface StreamFnOptions {
	server: ServerConfig;
	tools: ToolHelp[];
	trace: TraceWriter;
	/** Injected in tests. */
	fetchFn?: typeof fetch;
	/** Called with each piece of the reply as it arrives, for live display. */
	onDelta?: DeltaListener;
}

export type DeltaListener = (kind: "thinking" | "text", delta: string) => void;

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

/** The model object pi wants. Only id and baseUrl matter to us. */
export function makeModel(server: ServerConfig, contextWindow = 65536): Model<Api> {
	return {
		id: server.model,
		name: server.model,
		api: "openai-completions",
		provider: "local",
		baseUrl: server.baseUrl,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		reasoning: false,
		contextWindow,
		maxTokens: 8192,
	} as unknown as Model<Api>;
}

function textOf(content: string | readonly { type: string; text?: string }[]): string {
	if (typeof content === "string") return content;
	return content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string)
		.join("\n");
}

function toParsedCall(call: ToolCall): ParsedCall {
	const args: Record<string, string> = {};
	let body: string | undefined;
	for (const [key, value] of Object.entries(call.arguments)) {
		if (key === "content" && typeof value === "string") body = value;
		else args[key] = String(value);
	}
	return body === undefined ? { name: call.name, args } : { name: call.name, args, body };
}

/** Turns pi's transcript into plain chat messages, replaying tool calls as text. */
export function toChatMessages(messages: Message[]): ChatMessage[] {
	const out: ChatMessage[] = [];
	const push = (role: ChatMessage["role"], content: string) => {
		const last = out[out.length - 1];
		// Some chat templates (Gemma) reject two messages in a row from the same side.
		if (last && last.role === role && role !== "system") last.content += `\n\n${content}`;
		else out.push({ role, content });
	};
	for (const message of messages) {
		if (message.role === "system") {
			push("system", textOf(message.content));
		} else if (message.role === "user") {
			push("user", textOf(message.content));
		} else if (message.role === "toolResult") {
			push("user", renderResult(message.toolName, !message.isError, textOf(message.content)));
		} else {
			const parts: string[] = [];
			for (const block of message.content) {
				if (block.type === "text") {
					if (block.text.trim()) parts.push(block.text.trim());
				} else if (block.type === "toolCall") {
					const raw = block.arguments.raw;
					if (block.name === INVALID_CALL && typeof raw === "string") parts.push(raw.trim());
					else parts.push(renderCall(toParsedCall(block)));
				}
			}
			push("assistant", parts.join("\n"));
		}
	}
	return out;
}

/**
 * Checks a parsed call against the tool list and converts number arguments.
 * Returns a problem sentence instead of arguments when the call cannot run.
 */
export function checkCall(
	call: ParsedCall,
	tools: ToolHelp[],
): { ok: true; args: Record<string, string | number> } | { ok: false; problem: string } {
	const tool = tools.find((t) => t.name === call.name);
	if (!tool) {
		return { ok: false, problem: `There is no tool named "${call.name}". The tools are: ${tools.map((t) => t.name).join(", ")}.` };
	}
	const args: Record<string, string | number> = {};
	for (const spec of tool.args) {
		const raw = call.args[spec.name];
		if (raw === undefined || raw === "") {
			if (spec.required) return { ok: false, problem: `${tool.name} needs a "${spec.name}: ..." line.` };
			continue;
		}
		if (spec.type === "number") {
			const n = Number(raw);
			if (!Number.isFinite(n)) return { ok: false, problem: `${tool.name}: "${spec.name}" must be a number, got "${raw}".` };
			args[spec.name] = n;
		} else {
			args[spec.name] = raw;
		}
	}
	if (call.body !== undefined) {
		if (tool.body) args.content = call.body;
		// An empty --- section on a tool without text is harmless; only real text is a mistake.
		else if (call.body.trim() !== "") return { ok: false, problem: `${tool.name} does not take text after a --- line.` };
	}
	return { ok: true, args };
}

function usageOf(raw: unknown): Usage {
	const u = (raw ?? {}) as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
	const input = u.prompt_tokens ?? 0;
	const output = u.completion_tokens ?? 0;
	return { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: u.total_tokens ?? input + output, cost: { ...ZERO_COST } };
}

interface Reply {
	text: string;
	reasoning: string;
	usage: unknown;
	finish: string | null;
}

/**
 * Reads the server's answer. Replies are streamed: a slow local model can take
 * many minutes for one reply, and a non-streamed request is cut off by Node's
 * 5-minute wait for the response headers. A plain JSON answer is accepted too.
 */
export async function readReply(response: Response, onDelta?: DeltaListener): Promise<Reply> {
	const type = response.headers.get("content-type") ?? "";
	if (!type.includes("text/event-stream") || !response.body) {
		const data = (await response.json()) as any;
		const choice = data?.choices?.[0];
		return {
			text: typeof choice?.message?.content === "string" ? choice.message.content : "",
			reasoning: choice?.message?.reasoning ?? choice?.message?.reasoning_content ?? "",
			usage: data?.usage,
			finish: choice?.finish_reason ?? null,
		};
	}
	const reply: Reply = { text: "", reasoning: "", usage: undefined, finish: null };
	const decoder = new TextDecoder();
	let buffer = "";
	const takeLine = (line: string) => {
		if (!line.startsWith("data:")) return;
		const payload = line.slice(5).trim();
		if (payload === "" || payload === "[DONE]") return;
		let data: any;
		try {
			data = JSON.parse(payload);
		} catch {
			return;
		}
		const choice = data?.choices?.[0];
		const delta = choice?.delta;
		const thought = delta?.reasoning ?? delta?.reasoning_content;
		if (typeof thought === "string" && thought) {
			reply.reasoning += thought;
			onDelta?.("thinking", thought);
		}
		if (typeof delta?.content === "string" && delta.content) {
			reply.text += delta.content;
			onDelta?.("text", delta.content);
		}
		if (choice?.finish_reason) reply.finish = choice.finish_reason;
		if (data?.usage) reply.usage = data.usage;
	};
	for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
		buffer += decoder.decode(chunk, { stream: true });
		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			takeLine(buffer.slice(0, newline).trim());
			buffer = buffer.slice(newline + 1);
			newline = buffer.indexOf("\n");
		}
	}
	takeLine(buffer.trim());
	return reply;
}

export function createStreamFn(options: StreamFnOptions): StreamFn {
	const doFetch = options.fetchFn ?? fetch;
	let requestNo = 0;
	let sentCount = 0;

	return (model, context, streamOptions) => {
		const stream = createAssistantMessageEventStream();
		const started = Date.now();
		const base: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: usageOf(undefined),
			stopReason: "stop",
			timestamp: started,
		};

		const fail = (reason: "error" | "aborted", errorMessage: string) => {
			options.trace.write({ type: "model_error", request: requestNo, reason, error: errorMessage });
			stream.push({ type: "error", reason, error: { ...base, stopReason: reason, errorMessage } });
			stream.end();
		};

		void (async () => {
			const messages = toChatMessages(context.messages);
			const n = ++requestNo;
			const chars = messages.reduce((sum, m) => sum + m.content.length, 0);
			// Only the messages added since the last request are written, to keep the trace small.
			const fresh = messages.length >= sentCount ? messages.slice(sentCount) : messages;
			sentCount = messages.length;
			options.trace.write({ type: "request", request: n, messages: messages.length, chars, newMessages: fresh });

			// No stop sequence: on a thinking model it also cuts the thinking, which left the reply
			// empty (seen with Gemma 4 on Ollama). Text after @end is ignored by the parser instead.
			const body: Record<string, unknown> = {
				model: options.server.model,
				messages,
				stream: true,
				stream_options: { include_usage: true },
			};
			if (options.server.temperature !== undefined) body.temperature = options.server.temperature;

			let reply: Reply;
			try {
				const response = await doFetch(`${options.server.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						...(options.server.apiKey ? { authorization: `Bearer ${options.server.apiKey}` } : {}),
					},
					body: JSON.stringify(body),
					signal: streamOptions?.signal,
				});
				if (!response.ok) {
					const detail = (await response.text()).slice(0, 500);
					return fail("error", `Model server answered ${response.status}: ${detail}`);
				}
				reply = await readReply(response, options.onDelta);
			} catch (error) {
				if (streamOptions?.signal?.aborted) return fail("aborted", "Stopped.");
				return fail("error", `Could not reach the model server at ${options.server.baseUrl}: ${(error as Error).message}`);
			}

			const text = reply.text;
			const reasoning = reply.reasoning;
			const usage = usageOf(reply.usage);
			const parsed = parseReply(text);

			// The reasoning is kept for display only; toChatMessages never sends it back to the model.
			const content: (TextContent | ThinkingContent | ToolCall)[] = [];
			if (reasoning.trim()) content.push({ type: "thinking", thinking: reasoning.trim() });
			let kind: string = parsed.kind;
			let final = parsed.kind === "final";
			if (parsed.kind === "final" && parsed.text === "") {
				// An empty reply is never "finished": tell the model and let it try again.
				kind = "empty";
				final = false;
				content.push({
					type: "toolCall",
					id: `call_${n}`,
					name: INVALID_CALL,
					arguments: { problem: "Your reply was empty. Reply with one tool call, or with a short summary if you are finished.", raw: "(empty reply)" },
				});
			} else if (parsed.kind === "final") {
				content.push({ type: "text", text: parsed.text });
			} else {
				if (parsed.notes) content.push({ type: "text", text: parsed.notes });
				const id = `call_${n}`;
				if (parsed.kind === "malformed") {
					content.push({ type: "toolCall", id, name: INVALID_CALL, arguments: { problem: parsed.problem, raw: text } });
				} else {
					const checked = checkCall(parsed.call, options.tools);
					if (checked.ok) {
						content.push({ type: "toolCall", id, name: parsed.call.name, arguments: checked.args });
					} else {
						kind = "invalid";
						content.push({ type: "toolCall", id, name: INVALID_CALL, arguments: { problem: checked.problem, raw: text } });
					}
				}
			}

			const message: AssistantMessage = {
				...base,
				content,
				usage,
				stopReason: final ? "stop" : "toolUse",
				...(reply.finish ? { rawStopReason: reply.finish } : {}),
			};
			options.trace.write({
				type: "response",
				request: n,
				ms: Date.now() - started,
				kind,
				text,
				...(reasoning ? { reasoning } : {}),
				promptTokens: usage.input,
				outputTokens: usage.output,
				finish: reply.finish,
			});

			stream.push({ type: "start", partial: { ...base } });
			content.forEach((block, contentIndex) => {
				if (block.type === "thinking") {
					stream.push({ type: "thinking_start", contentIndex, partial: message });
					stream.push({ type: "thinking_delta", contentIndex, delta: block.thinking, partial: message });
					stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: message });
				} else if (block.type === "text") {
					stream.push({ type: "text_start", contentIndex, partial: message });
					stream.push({ type: "text_delta", contentIndex, delta: block.text, partial: message });
					stream.push({ type: "text_end", contentIndex, content: block.text, partial: message });
				} else {
					stream.push({ type: "toolcall_start", contentIndex, partial: message });
					stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: message });
				}
			});
			stream.push({ type: "done", reason: final ? "stop" : "toolUse", message });
			stream.end();
		})().catch((error) => fail("error", `Unexpected error: ${(error as Error).message}`));

		return stream;
	};
}
