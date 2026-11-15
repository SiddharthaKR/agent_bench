# Task B: local HTTP server

Read `briefs/common.md` first and follow it (it has the full HTTP contract).

Create ONLY: files under `src/server/` EXCEPT `src/server/main.ts` (someone else writes that), and `test/server.test.ts`.

Read: `src/shared/api.ts`, `src/shared/engine.ts`, `src/tools/paths.ts` (`resolveInWorkspace`).

## What it is

A small HTTP server using only `node:http`, `node:fs/promises`, `node:path`, `node:crypto`. No framework. It serves the JSON API in the contract, two event streams, and the built browser app as static files. All agent logic lives behind the `Engine` interface, which is passed in; the server must be testable with a fake engine.

## Exports (`src/server/http.ts`)

```ts
import type { Server } from "node:http";
import type { Engine } from "../shared/engine.ts";

export interface ServerOptions {
	/** Folder holding the built browser app (index.html, assets). Optional. */
	webDir?: string;
}
export function createAppServer(engine: Engine, options?: ServerOptions): Server;
```

Split helpers into other files under `src/server/` as you see fit (for example `files.ts` for the tree and file routes, `sse.ts`).

## Behaviour

- Sessions and runs created through the API are kept in in-memory maps by id. Unknown id -> 404 `{ error: "No such session." }` / `No such run.`
- Request bodies: JSON, at most 5 MB (413 otherwise). Invalid JSON -> 400.
- Safety, because this server can write files:
  - If the request has an `Origin` header, its host must be `localhost`, `127.0.0.1` or `[::1]` (any port); otherwise 403 `{ error: "Requests from other sites are not allowed." }`.
  - The `Host` header's hostname must be `localhost`, `127.0.0.1` or `[::1]`; otherwise 403.
- `GET /api/tree`: `folder` must be an absolute path to an existing folder (400 with a clear sentence otherwise). Returns nested `TreeNode[]`. Skip entries named `.git`, `node_modules`, `.build`, `runs`, `__pycache__`, `dist`. Folders first, then files, each sorted by name (case-insensitive). Depth limit 8. Stop after 5000 entries. Do not follow symbolic links.
- `GET /api/file`: path resolved with `resolveInWorkspace(folder, path)`; its error text -> 400. Missing file -> 404 `File not found: <path>`. Files over 2 MB or containing a NUL byte -> 400 `<path> is not a text file the editor can open.` Returns text with CRLF normalised to LF.
- `PUT /api/file`: same path rule; creates parent folders; writes the text as given.
- `POST /api/sessions`: validates that `agent`, `folder`, `server` are non-empty strings and `askFirst` is a boolean, then `engine.createSession`. An error thrown by the engine -> 400 with its message.
- Event streams (`/events`): headers `content-type: text/event-stream`, `cache-control: no-cache`, `connection: keep-alive`. Write every event in `session.events` (or `run.events`) first, then subscribe and write new ones. Each as `data: <json>\n\n`. Send a comment line `: ping\n\n` every 25 seconds. On client close: unsubscribe and clear the timer.
- `PUT /api/workflows/:id`: the body's `id` must equal the URL id (400 otherwise). Ids match `^[a-z0-9][a-z0-9_-]{0,63}$` (400 otherwise).
- `POST /api/runs`: `engine.createWorkflowRun(request)`, store it, call `run.start()`, answer `{ id }`.
- Static files: any GET not under `/api/` is served from `webDir` (if set). Resolve safely inside `webDir` (no `..` escape). Content types for `.html .js .css .json .svg .png .ico .woff2 .map`. A path with no file extension that does not exist -> serve `index.html`. No `webDir` or missing file -> 404 plain text.
- Unknown `/api/` route -> 404 `{ error: "Unknown route." }`. Wrong method -> 405.
- Any unexpected exception -> 500 `{ error: "<message>" }`; the server must not crash.

## Tests (`test/server.test.ts`)

Start the server on port 0 (`server.listen(0, "127.0.0.1")`) with a FAKE engine (plain objects implementing `Engine`, `Session`, `WorkflowRun`, recording calls). Use real temp folders for the file routes. Use global `fetch`. Close the server after each test. Cover at least: config; tree (ordering, skipped names, nested, bad folder); file read (ok, CRLF normalised, not found, escape with `..` rejected, binary rejected); file write (creates parent folders); session create (validation, engine error -> 400), message, stop, resolve, ask-first, unknown id -> 404; session event stream replays past events and then delivers a new one (read the response body stream and parse `data:` lines); workflows list/save/delete (id mismatch and bad id rejected); run create calls `start()`, resume passes `fromStepId`, stop; run event stream; Origin from another site -> 403; bad Host -> 403; body too large -> 413; invalid JSON -> 400; static file served, unknown route without extension falls back to index.html, `..` escape blocked; unknown API route -> 404.

## Verify

- `npx vitest run test/server.test.ts` passes.
- `npx tsc --noEmit` shows no errors in your files (errors elsewhere belong to others: ignore, but mention them).
