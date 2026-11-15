import { createInterface } from "node:readline";
import type { ReadLineOptions } from "node:readline";
import type { Question } from "./types.ts";

export function terminalAnswer(prompt: string, signal?: AbortSignal, onInterrupt?: () => void, streams: ReadLineOptions = { input: process.stdin, output: process.stdout }): Promise<string | undefined> {
	if (signal?.aborted) return Promise.resolve(undefined);
	return new Promise((resolve) => {
		const input = createInterface(streams);
		let finished = false;
		const finish = (answer?: string) => {
			if (finished) return;
			finished = true;
			signal?.removeEventListener("abort", abort);
			input.close();
			resolve(answer?.trim() || undefined);
		};
		const abort = () => finish();
		input.once("SIGINT", () => { onInterrupt?.(); finish(); });
		input.once("close", () => finish());
		signal?.addEventListener("abort", abort, { once: true });
		input.question(prompt, (answer) => finish(answer));
	});
}

export function questionReader(enabled: boolean, reader?: (prompt: string) => Promise<string | undefined>, signal?: AbortSignal, onInterrupt?: () => void): ((question: Question) => Promise<string | undefined>) | undefined {
	if (!enabled) return undefined;
	return async (question) => {
		const prompt = [question.question, question.assumption ? `Assumption: ${question.assumption}` : "", "Answer: "].filter(Boolean).join("\n");
		if (reader) return reader(prompt);
		return terminalAnswer(prompt, signal, onInterrupt);
	};
}
