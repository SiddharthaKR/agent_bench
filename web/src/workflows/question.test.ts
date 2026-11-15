import { it, expect } from "vitest";
import { applyRunEvent } from "./logic.ts";
import type { RunView } from "./logic.ts";
it("replays and resolves the workflow question card", () => {
	const prior: RunView = { id: "r", workflow: { id: "w", name: "W", task: "T", vars: {}, steps: [] }, folder: ".", lines: {} };
	const question = { type: "question" as const, id: "q", stepId: "s", question: "Latency?", assumption: "One cycle.", answer: null };
	const waiting = applyRunEvent(prior, question);
	expect(waiting.question).toEqual(question);
	expect(applyRunEvent(waiting, { ...question, answer: "Two cycles." }).question).toBeUndefined();
});
