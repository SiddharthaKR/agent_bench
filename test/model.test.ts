import { describe, expect, it } from "vitest";
import { checkCall, readReply, toChatMessages } from "../src/model.ts";
import type { ToolHelp } from "../src/types.ts";

function sse(chunks: string[]): Response {
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const delta = (d: object, extra: object = {}) => `data: ${JSON.stringify({ choices: [{ delta: d, ...extra }] })}\n\n`;

describe("readReply", () => {
	it("joins streamed text, thinking, usage and finish reason", async () => {
		const reply = await readReply(
			sse([
				delta({ reasoning: "Read the " }),
				delta({ reasoning: "spec first." }),
				delta({ content: "@tool read_file\n" }),
				delta({ content: "path: spec.md\n@end" }, { finish_reason: "stop" }),
				`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 9, total_tokens: 49 } })}\n\n`,
				"data: [DONE]\n\n",
			]),
		);
		expect(reply.text).toBe("@tool read_file\npath: spec.md\n@end");
		expect(reply.reasoning).toBe("Read the spec first.");
		expect(reply.finish).toBe("stop");
		expect(reply.usage).toEqual({ prompt_tokens: 40, completion_tokens: 9, total_tokens: 49 });
	});

	it("handles an event split across network chunks and a missing final newline", async () => {
		const whole = delta({ content: "hello " }) + delta({ content: "world" }).trimEnd();
		const cut = Math.floor(whole.length / 3);
		const reply = await readReply(sse([whole.slice(0, cut), whole.slice(cut, cut * 2), whole.slice(cut * 2)]));
		expect(reply.text).toBe("hello world");
	});

	it("ignores comment lines and lines that are not JSON", async () => {
		const reply = await readReply(sse([": keep-alive\n\n", "data: not json\n\n", delta({ content: "ok" })]));
		expect(reply.text).toBe("ok");
	});

	it("accepts a plain JSON answer", async () => {
		const response = new Response(
			JSON.stringify({ choices: [{ message: { content: "Done.", reasoning_content: "thinking" }, finish_reason: "stop" }], usage: { prompt_tokens: 5 } }),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
		expect(await readReply(response)).toEqual({ text: "Done.", reasoning: "thinking", usage: { prompt_tokens: 5 }, finish: "stop" });
	});
});

describe("checkCall", () => {
	const tools: ToolHelp[] = [
		{
			name: "replace_lines",
			summary: "",
			args: [
				{ name: "path", type: "string", required: true, help: "" },
				{ name: "from", type: "number", required: true, help: "" },
				{ name: "to", type: "number", required: true, help: "" },
			],
			body: { help: "" },
		},
		{ name: "read_file", summary: "", args: [{ name: "path", type: "string", required: true, help: "" }] },
	];

	it("converts number arguments and passes the text as content", () => {
		expect(checkCall({ name: "replace_lines", args: { path: "a.v", from: "3", to: "5" }, body: "x" }, tools)).toEqual({
			ok: true,
			args: { path: "a.v", from: 3, to: 5, content: "x" },
		});
	});

	it("names the missing argument", () => {
		expect(checkCall({ name: "replace_lines", args: { path: "a.v", from: "3" } }, tools)).toEqual({
			ok: false,
			problem: 'replace_lines needs a "to: ..." line.',
		});
	});

	it("rejects a number that is not a number", () => {
		const result = checkCall({ name: "replace_lines", args: { path: "a.v", from: "three", to: "5" } }, tools);
		expect(result).toEqual({ ok: false, problem: 'replace_lines: "from" must be a number, got "three".' });
	});

	it("lists the real tools when the name is unknown", () => {
		const result = checkCall({ name: "open_file", args: {} }, tools);
		expect(result).toEqual({ ok: false, problem: 'There is no tool named "open_file". The tools are: replace_lines, read_file.' });
	});

	it("ignores an empty --- section on a tool without text but rejects real text", () => {
		expect(checkCall({ name: "read_file", args: { path: "a.v" }, body: "\n" }, tools)).toEqual({ ok: true, args: { path: "a.v" } });
		expect(checkCall({ name: "read_file", args: { path: "a.v" }, body: "module" }, tools).ok).toBe(false);
	});
});

describe("toChatMessages", () => {
	it("merges two user messages in a row so roles always alternate", () => {
		const out = toChatMessages([
			{ role: "system", content: "sys", timestamp: 0 },
			{ role: "user", content: "first", timestamp: 0 },
			{ role: "user", content: "second", timestamp: 0 },
		]);
		expect(out).toEqual([
			{ role: "system", content: "sys" },
			{ role: "user", content: "first\n\nsecond" },
		]);
	});
});
