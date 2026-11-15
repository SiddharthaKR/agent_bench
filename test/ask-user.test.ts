import { it, expect } from "vitest";
import { askUser, createQuestionHandler, UNAVAILABLE } from "../src/tools/ask_user.ts";
import type { ToolContext, TraceEvent } from "../src/types.ts";
const ctx = { workspace: ".", commands: { compile: [], simulate: [] }, exec: async () => { throw new Error("unused"); } } satisfies ToolContext;
it("asks, records answers and enforces the question limit", async () => {
	const events: TraceEvent[] = [];
	const handler = createQuestionHandler({ onQuestion: async () => "Two cycles.", trace: { write: (event) => events.push(event) }, maxQuestions: 1 });
	expect(await askUser.run({ content: "Latency?", assumption: "One cycle." }, { ...ctx, onQuestion: handler.ask })).toEqual({ ok: true, text: "Answer: Two cycles." });
	expect((await askUser.run({ content: "Reset?" }, { ...ctx, onQuestion: handler.ask })).text).toBe(UNAVAILABLE);
	expect(handler.counts()).toEqual({ questions: 2, unanswered: 1 });
	expect(events).toHaveLength(2);
	expect(events[0]).toMatchObject({ type: "question", question: "Latency?", assumption: "One cycle.", answer: "Two cycles.", seconds: expect.any(Number) });
});
it("reports unavailable and rejects empty questions", async () => {
	expect((await askUser.run({ content: "Reset?" }, ctx)).text).toBe(UNAVAILABLE);
	expect((await askUser.run({ content: "  " }, ctx)).ok).toBe(false);
});
it("ends a pending question on stop", async () => {
	const controller = new AbortController();
	const handler = createQuestionHandler({ onQuestion: () => new Promise(() => {}) });
	const pending = handler.ask({ question: "Width?" }, controller.signal);
	controller.abort();
	expect(await pending).toBeUndefined();
});
