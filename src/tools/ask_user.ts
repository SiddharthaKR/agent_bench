import type { Question, ToolSpec, TraceWriter } from "../types.ts";

export const UNAVAILABLE = "No one can answer now. Continue with your assumption and state it in your final summary.";

export const askUser: ToolSpec = {
	name: "ask_user",
	summary: "Ask one short question when an unclear requirement changes the design. State your assumption if nobody can answer.",
	args: [{ name: "assumption", type: "string", required: false, help: "what to assume if nobody answers" }],
	body: { help: "one short question (required)" },
	async run(args, ctx) {
		const question = String(args.content ?? "").trim();
		if (!question) return { ok: false, text: "ask_user needs a question after a --- line." };
		const answer = await ctx.onQuestion?.({ question, assumption: typeof args.assumption === "string" ? args.assumption : undefined }, ctx.signal);
		return { ok: true, text: answer === undefined ? UNAVAILABLE : `Answer: ${answer}` };
	},
};

export function createQuestionHandler(options: {
	onQuestion?: (question: Question) => Promise<string | undefined>;
	maxQuestions?: number;
	budget?: { used: number };
	trace?: Pick<TraceWriter, "write">;
	onWait?: (waiting: boolean) => void;
}) {
	const budget = options.budget ?? { used: 0 };
	let questions = 0;
	let unanswered = 0;
	return {
		counts: () => ({ questions, unanswered }),
		reset() { questions = 0; unanswered = 0; budget.used = 0; },
		async ask(question: Question, signal?: AbortSignal): Promise<string | undefined> {
			questions++;
			budget.used++;
			const started = Date.now();
			let answer: string | undefined;
			const available = budget.used <= Math.max(0, options.maxQuestions ?? 2) && options.onQuestion && !signal?.aborted;
			if (available) {
				options.onWait?.(true);
				let abort: (() => void) | undefined;
				try {
					answer = await new Promise<string | undefined>((resolve, reject) => {
						abort = () => resolve(undefined);
						signal?.addEventListener("abort", abort, { once: true });
						if (signal?.aborted) return resolve(undefined);
						Promise.resolve().then(() => signal?.aborted ? undefined : options.onQuestion!(question)).then(resolve, reject);
					});
				} catch {
					answer = undefined;
				} finally {
					if (abort) signal?.removeEventListener("abort", abort);
					options.onWait?.(false);
				}
			}
			if (!answer?.trim()) { answer = undefined; unanswered++; }
			options.trace?.write({ type: "question", question: question.question, assumption: question.assumption ?? null, answer: answer ?? null, seconds: (Date.now() - started) / 1000 });
			return answer;
		},
	};
}
