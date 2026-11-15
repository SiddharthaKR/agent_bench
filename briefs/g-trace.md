# Task G: the Trace screen

Read `briefs/common.md` first and follow it, with this change to its file rule: in this task you OWN and may edit `src/server/**` (including `main.ts`), `web/src/App.tsx`, `web/src/api.ts`, and you create `src/shared/trace.ts`, `src/traces.ts`, `web/src/trace/**`, and tests. Do NOT touch `src/agent.ts`, `src/session.ts`, `src/guard.ts`, `src/protocol.ts`, `src/tools/**`, `src/engine.ts`, `src/model.ts`, `src/workflow.ts`, `src/shared/api.ts`, `src/shared/engine.ts`, `agents/**`, `web/src/work/**`, `web/src/workflows/**`, `web/src/theme.css`.

## Purpose

The user wants to see exactly what the agent sent to the model and what the model answered: the system prompt, each message, the model's thinking, each tool call, each tool result, and where it went wrong. Every run already writes a trace to disk. This screen reads those traces. It replaces a separate logging proxy the user used before.

## Trace files (already written by the engine; read `src/trace.ts`, `src/model.ts`, `src/agent.ts`, `src/session.ts`)

Each run has a folder under `<repo>/runs/` (or another runs folder) holding `trace.jsonl` (one JSON object per line, each with `n`, `t` and `type`) and, when the run ended, `summary.json`. Event types and their fields:
- `run_start`: `agent`, `model`, `server?`, `workspace`, `task?`, `tools?`, `promptChars`, `systemPrompt`
- `request`: `request` (number), `messages` (count), `chars`, `newMessages` (array of `{ role: "system"|"user"|"assistant", content }` added since the previous request)
- `response`: `request`, `ms`, `kind` (`final`, `call`, `malformed`, `invalid`, `empty`), `text`, `reasoning?`, `promptTokens`, `outputTokens`, `finish`
- `tool_call` (command-line runs only): `tool`, `args`, `contentChars?`, `content?`
- `tool_result`: `tool`, `ok`, `ms`, `text`
- `guard`: `tool`, `reason`, `stop?`
- `model_error`: `request`, `reason`, `error`
- `run_end`: the run result (reason, counts, tokens, ms)
Be tolerant: unknown types and missing fields must not break anything.

## Server side

- `src/shared/trace.ts` (types only):
  ```ts
  export interface TraceInfo { id: string; agent: string; model: string; task: string; startedAt: string; ended: boolean; reason?: string; modelCalls: number; toolErrors: number; }
  export interface TraceRow { id: string; call: number; direction: "sent" | "received"; kind: "system" | "user" | "thinking" | "tool call" | "tool result" | "tool error" | "bad tool call" | "reply" | "guard" | "error"; title: string; text: string; meta: string; raw: unknown; }
  export interface TraceDetail { info: TraceInfo; contextTokens: number; outputTokens: number; elapsedMs: number; rows: TraceRow[]; }
  ```
- `src/traces.ts`: `listTraces(runsDir): Promise<TraceInfo[]>` (newest first, at most 200; `id` is the folder name; skip folders without `trace.jsonl`) and `readTrace(runsDir, id): Promise<TraceDetail | null>` (id must match `^[A-Za-z0-9._-]+$` and resolve inside `runsDir`; read at most 20,000 lines). Building rows, in file order:
  - `run_start`: nothing (its prompt appears through the first request).
  - `request`: one row per entry of `newMessages`, direction `sent`, `call` = the request number. Role `system` -> kind `system`; role `user` whose content starts with `@result ` -> kind `tool error` if its first line ends with ` error`, else `tool result`; other `user` -> `user`; role `assistant` -> skip (it was already shown as a response).
  - `response`: if `reasoning` is non-empty, a `thinking` row; then one row for the text: `final` -> `reply`, `call` -> `tool call`, `malformed`/`invalid`/`empty` -> `bad tool call`. Direction `received`.
  - `guard` -> kind `guard`, direction `sent`. `model_error` -> kind `error`, direction `received`.
  - `tool_call` and `tool_result`: skip (the next request shows the result as the model saw it).
  - `title`: first non-empty line of the text, at most 140 characters. `meta`: `call #<n> · <kind> · <chars> chars` plus ` · <promptTokens> tokens context` on received rows and ` · <ms> ms` when known. `raw`: the original event object (for a request row, `{ request, role, content }`).
  - `contextTokens` = `promptTokens` of the last response; `outputTokens` = sum; `elapsedMs` from the first to the last event time. `toolErrors` = number of `tool error` rows.
- Routes (add to the HTTP server; `createAppServer` gets a new option `runsDirs: string[]`, searched in order, and `main.ts` passes `<repo>/runs`):
  - `GET /api/traces` -> `TraceInfo[]`
  - `GET /api/traces/:id` -> `TraceDetail`, 404 `{ error: "No such trace." }`
- Tests: build small trace folders in a temp dir and check listing order, the row mapping for each event kind, tolerance of junk lines and unknown types, the id check, and both routes.

## Browser side

- `web/src/api.ts`: add `traces()` and `trace(id)`.
- `web/src/App.tsx`: add a third tab `Trace` after `Workflows`, rendering `<TraceScreen {...props} />` from `web/src/trace/TraceScreen.tsx` the same way the other screens are mounted. Change nothing else in the shell.
- The screen (styles in `web/src/trace/trace.css`, using only `theme.css` variables and classes):
  - Header row: `<h1>Trace</h1>`, the selected run's agent and model (muted), a checkbox `Errors only`, a checkbox `Follow the latest run` (when on: reload the list every 3 s and select and reload the newest run), and a `Reload` button.
  - Left column (260px, `card`): label `Runs`, one button per run, newest first: first line = the task's first 60 characters (or `Chat session` when there is no task), second line small and muted = local date and time, model calls, and `ended: <reason>` or `running`. Selected run highlighted with `var(--tint)`. Empty: `No runs yet. Every agent run is recorded here.`
  - Right: four small cards in a row (`LLM calls`, `Context (last)` in thousands with one decimal and `k`, `Tool errors`, `Elapsed` as `1m 12s`), then the timeline: one row per `TraceRow`, each a button. Row layout: direction text (`agent → model` or `model → agent`, 110px, small, muted), a kind tag (fixed min-width 92px, centred, 12px, 6px radius), the title (ellipsis), and `#<call>` at the right (small, muted). Rows with kind `tool error`, `bad tool call` or `error` get a `var(--bad)` border.
  - Kind tag colours, defined as CSS variables in `trace.css` for light and for `:root[data-theme="dark"]`: thinking (light `#eeedfe` / `#534ab7`, dark `#26215c` / `#afa9ec`), tool call (`#e6f1fb` / `#185fa5`, dark `#0c2f52` / `#85b7eb`), tool result (`#eaf3de` / `#3b6d11`, dark `#1f3608` / `#97c459`), tool error, bad tool call and error (`#fcebeb` / `#a32d2d`, dark `#4a1414` / `#f09595`), guard (`#faeeda` / `#854f0b`, dark `#3d2504` / `#ef9f27`), system, user and reply use `var(--pill)` / `var(--muted)`.
  - Clicking a row expands it: the `meta` line (small, muted), the full text (mono, 12px, preserved whitespace, wraps, max height 420px with scroll), and two buttons: `Copy` (copies the text; show `Copied` for 1.5 s) and `Raw JSON` (toggles a second block with `JSON.stringify(raw, null, 1)`).
  - `Errors only` shows only `tool error`, `bad tool call`, `guard` and `error` rows.
  - No run selected or nothing to show: `Nothing to show.`
- Keep the pure parts (formatting elapsed time, tokens, filtering) in `web/src/trace/logic.ts` with a small vitest test file beside it.

## Verify

- `npx vitest run` passes completely (root).
- `npx tsc --noEmit` clean at the root and in `web/`.
- Do not start a dev server.
