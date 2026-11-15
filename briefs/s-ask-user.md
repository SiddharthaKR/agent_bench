# Task S: the agent asks instead of guessing

You are the only task running. You may edit the shared files (`src/shared/*`, `src/types.ts`, `web/src/api.ts`) and `briefs/common.md` (add the new routes to the contract). Do not edit `agents/`, `workflows/`, `evals/`, `PLAN.md`.

Why (owner's decision, 2026-11-15): when a spec is unclear on something that changes the design (latency, reset, rounding, widths, bus timing) the agent must be able to stop and ask the user, not guess. Where nobody can answer, it states its assumption and goes on.

## The tool

New tool `ask_user` (`src/tools/ask_user.ts`), available to an agent only when its `agent.json` lists it in `tools`:

- argument `assumption` (optional, text): what the agent will assume if nobody answers;
- body: one short question.

Result text:
- answered: `Answer: <text>`
- nobody available, or the limit is reached: `No one can answer now. Continue with your assumption and state it in your final summary.`
- empty question: an error result.

Limit: at most 2 questions per run (`maxQuestions` in `agent.json`, default 2). Sub-agents never get the tool.

Every question is written to the trace (`type: "question"`, with question, assumption, answer or `null`, seconds waited) and shown on the Trace screen as its own row. The run summary gets `questions: number` and `unanswered: number`.

## Who answers

The engine gets one optional hook, `onQuestion(question): Promise<string | undefined>` (undefined = nobody available). Waiting time does not count toward the run's or the step's time limit. A stop while waiting ends the wait.

- **Work screen session:** emit a `question` session event; the session status becomes `waiting`. The user's next message, or `POST /api/sessions/:id/answer { questionId, text }`, is the answer and the agent continues in the same turn. The chat shows the question as a card with the assumption under it, an answer box and a "Use the assumption" button (which answers with `Use your assumption.`).
- **Workflow run started from the app:** the run status becomes `waiting`, a `question` workflow event carries step id, question and assumption; `POST /api/runs/:id/answer { questionId, text }` continues it. The Workflows screen shows the same card in the run panel.
- **Command line:** new flag `--ask` on `npm run agent` and `npm run workflow`: the question is printed and the answer read from the terminal. Without `--ask`, and always in `scripts/eval_local.sh` and `scripts/h_task.sh`, nobody is available.
- **Code API:** the `onQuestion` option; absent means nobody is available.

## Tests

- Tool: answered, unavailable, limit reached, empty question, not offered to sub-agents, not offered unless listed.
- Session: event, waiting status, answer by message and by route, "use the assumption", stop while waiting.
- Workflow: waiting status, answer route, time limit excludes the wait.
- CLI: `--ask` reads an answer (inject the reader in the test); without it the unavailable text.
- Trace row and summary counts.
- Web: reducers for the new events; the card's logic.

Finish with `npx.cmd tsc --noEmit` (root and `web/`), `npx.cmd vitest run`, and `npm.cmd --prefix web run build`.
