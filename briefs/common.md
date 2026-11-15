# Rules for every build task in this repository

Project: Agent Bench, a light harness that lets local language models do hardware coding. TypeScript, ESM, Node 24, strict mode with `noUncheckedIndexedAccess`. Tests use vitest. Dependencies are installed (root and `web/`).

- Touch ONLY the files your task lists. Other people are editing other files at the same time. Do not edit shared files (`src/shared/*`, `src/types.ts`, `web/src/App.tsx`, `web/src/api.ts`, `web/src/theme.css`, `package.json`) even to "fix" them: report the problem instead.
- Do not run `npm install`. Do not add dependencies. Do not use git.
- Imports inside `src/` and `test/` use `.ts` extensions (`import { x } from "./file.ts"`). Inside `web/src/` use `.ts` / `.tsx` extensions too.
- Tabs for indentation. Double quotes. Semicolons.
- Comments: short, and only where the reason is not obvious. No decorative banners.
- Text shown to the user is plain and short. Sentence case. No exclamation marks.
- Read `src/shared/api.ts` and `src/shared/engine.ts` first: they are the contract.

## HTTP contract (local server)

All bodies are JSON. Errors are non-2xx with `{ "error": "<sentence>" }`.

```
GET    /api/config                              -> AppConfig
GET    /api/tree?folder=<abs path>              -> TreeNode[]
GET    /api/file?folder=<abs>&path=<rel>        -> { text }
PUT    /api/file            { folder, path, text }        -> { ok: true }
POST   /api/sessions        CreateSessionRequest          -> CreateSessionResponse
GET    /api/sessions/:id/events                 -> server-sent events, one SessionEvent per message
POST   /api/sessions/:id/message   { text }               -> { ok: true }
POST   /api/sessions/:id/answer { questionId, text }       -> { ok: true }
POST   /api/sessions/:id/stop                             -> { ok: true }
POST   /api/sessions/:id/resolve   { proposalId, accept } -> { ok: true }
POST   /api/sessions/:id/ask-first { askFirst }           -> { ok: true }
GET    /api/workflows                           -> Workflow[]
PUT    /api/workflows/:id   Workflow                      -> { ok: true }
DELETE /api/workflows/:id                                 -> { ok: true }
POST   /api/runs            RunWorkflowRequest            -> RunWorkflowResponse   (creates and starts the run)
GET    /api/runs/:id/events                     -> server-sent events, one WorkflowEvent per message
POST   /api/runs/:id/resume { fromStepId? }               -> { ok: true }
POST   /api/runs/:id/answer { questionId, text }           -> { ok: true }
POST   /api/runs/:id/stop                                 -> { ok: true }
```

Event streams replay every past event first, then send new ones as `data: <json>\n\n`.

## When you finish

Reply with: the files you created, the test and type-check results, and anything in the brief you could not follow or found ambiguous and how you resolved it. Keep it short.
