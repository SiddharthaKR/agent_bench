import { useState } from "react";
import type { UserQuestion } from "../../src/shared/api.ts";

export const ASSUMPTION_ANSWER = "Use your assumption.";
export function answerText(text: string): string | undefined {
	return text.trim() || undefined;
}

export function QuestionCard({ question, answer, disabled = false }: { question: UserQuestion; answer: (text: string) => Promise<unknown>; disabled?: boolean }) {
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState("");
	async function submit(value: string) {
		const trimmed = answerText(value);
		if (!trimmed || sending || disabled || question.pending === false) return;
		setSending(true);
		try { await answer(trimmed); setError(""); }
		catch (error) { setError(error instanceof Error ? error.message : String(error)); }
		finally { setSending(false); }
	}
	return <section className="card" aria-label="Question from agent">
		<p>{question.question}</p>
		{question.assumption && <p className="small muted">Assumption: {question.assumption}</p>}
		{question.answer !== null ? <p>Answer: {question.answer}</p> : question.pending === false ? <p className="muted">No answer.</p> : <form onSubmit={(event) => { event.preventDefault(); void submit(text); }}>
			<input className="input" aria-label="Answer to agent" value={text} disabled={disabled || sending} onChange={(event) => setText(event.target.value)} />
			<button className="btn btn-primary" type="submit" disabled={disabled || sending || !answerText(text)}>Answer</button>
			<button className="btn" type="button" disabled={disabled || sending} onClick={() => void submit(ASSUMPTION_ANSWER)}>Use the assumption</button>
		</form>}
		{error && <p role="alert" className="tone-bad">{error}</p>}
	</section>;
}
