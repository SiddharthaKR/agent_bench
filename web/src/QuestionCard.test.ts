import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { QuestionCard, answerText, ASSUMPTION_ANSWER } from "./QuestionCard.tsx";
it("shows the question, assumption, answer box and assumption action", () => {
	const question = { id: "q", question: "Latency?", assumption: "One cycle.", answer: null };
	const html = renderToStaticMarkup(createElement(QuestionCard, { question, answer: async () => {} }));
	for (const text of ["Latency?", "Assumption: One cycle.", 'aria-label="Answer to agent"', "Use the assumption"]) expect(html).toContain(text);
	expect(answerText("  Two cycles.  ")).toBe("Two cycles.");
	expect(answerText("  ")).toBeUndefined();
	expect(ASSUMPTION_ANSWER).toBe("Use your assumption.");
	const answered = renderToStaticMarkup(createElement(QuestionCard, { question: { ...question, answer: "Two cycles." }, answer: async () => {} }));
	expect(answered).toContain("Answer: Two cycles.");
	expect(answered).not.toContain("<form");
});
