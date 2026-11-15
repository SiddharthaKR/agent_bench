# Task K: MCP servers as agent tools

Read `briefs/common.md` first and follow it, with this change to its file rule: in this task you OWN and may edit `src/agent.ts`, `src/session.ts`, `src/subagent.ts`, `src/agent-store.ts`, `src/shared/agents.ts`, `web/src/agents/**`, and you create `src/mcp.ts`, `test/fixtures/**`, and tests. The package `@modelcontextprotocol/sdk` is already installed at the root; use it and nothing else new. Do NOT touch `src/server/**`, `src/engine.ts`, `src/workflow.ts`, `src/model.ts`, `src/tools/**`, `src/shared/api.ts`, `web/src/App.tsx`, `web/src/api.ts`, other `web/src/**` folders.

Read first: `src/agent.ts`, `src/session.ts`, `src/types.ts` (`ToolSpec`), `src/agent-store.ts`, `web/src/agents/AgentsScreen.tsx`, and the SDK's README and type files under `node_modules/@modelcontextprotocol/sdk` for the client API (`Client`, `StdioClientTransport`).

## Purpose

The user wants to plug existing MCP servers (for example a documentation search) into an agent. Each tool of an enabled MCP server becomes one more tool the agent can call, through the same plain-text tool format as the built-in tools.

## Rules

- `agent.json` may have `"mcp": [{ "name": "docs", "command": "node", "args": ["server.js"], "env": { "KEY": "value" }, "enabled": true }]`. Only stdio servers. `name` matches `^[a-z0-9][a-z0-9_]{0,23}$`.
- `src/mcp.ts`: `connectMcp(servers, options?) -> Promise<{ tools: ToolSpec[]; problems: string[]; close(): Promise<void> }>`.
  - Start each enabled server, list its tools (timeout 10 s per server). A server that fails to start or list is reported in `problems` (`MCP server "<name>" could not start: <reason>`) and skipped; it must not stop the agent.
  - Each MCP tool becomes a `ToolSpec` named `<server>_<tool>` (non `[A-Za-z0-9_]` characters in the tool name replaced by `_`). `summary` = the first sentence of its description, at most 120 characters. Arguments come from the tool's JSON input schema: top-level properties of type `string`, `number` or `integer` become `ArgSpec`s (required per the schema, help = the property description cut to 60 characters); a property of any other type becomes a string argument whose help ends with `(JSON)` and whose value is parsed with `JSON.parse` before the call (a parse error is an error result naming the argument).
  - `run` calls the tool (timeout 60 s) and returns the text content joined with newlines, cut to 2000 characters with `(output cut)` when longer; `isError` results and thrown errors are `{ ok: false, text }`.
  - At most 12 tools per server are exposed; if a server has more, add a problem line `MCP server "<name>" has <n> tools; only the first 12 are used to keep the prompt small.`
- Wiring: `loadAgent` does NOT start servers. `runAgent` and `createSession` call `connectMcp` when the agent has enabled servers, add the tools to the agent's tools and tool help, write each problem to the trace and (session) emit it as a `note` with tone `bad`, and close them again: `runAgent` when the run ends; the session keeps them open while it lives and closes them when the process exits (the `Session` interface must not change). Sub-agents connect their own servers.
- MCP tools are not edits and need no approval.
- Agents screen: `AgentDetail` gets `mcp: { name: string; command: string; args: string[]; enabled: boolean }[]` and `AgentUpdate` gets the same field; `saveAgent` validates names and non-empty commands and keeps `env` already in the file for a server with the same name. Add a card `MCP servers` to `web/src/agents/AgentsScreen.tsx`: one row per server with a checkbox, the name, and the command line (mono, small); an `Add MCP server` dashed button revealing `Name`, `Command`, `Arguments` (space-separated, double quotes for an argument with spaces) and `Add`; a remove button per row; and a muted note: `Each tool of an enabled server is added to this agent's prompt. Keep the list short.` Empty: `No MCP servers connected.`

## Tests

- `test/fixtures/mcp-echo-server.mjs`: a tiny stdio MCP server built with the SDK's server classes exposing `echo` (string `text`, required), `add` (numbers `a`, `b`), `search` (object `filter`, optional), and `fail` (always returns an error). Tests start it with `process.execPath`.
- Cover: tool names, summaries and argument mapping; calling `echo`, `add`, the JSON argument, the error result, output cutting; a server whose command does not exist -> problem, no throw; the 12-tool cap (a second fixture or a flag on the first); `close()` ends the child process; `runAgent` with a scripted fake model that calls `<server>_echo` and gets the result back; the agent store round-trips the `mcp` field and keeps `env`.

## Verify

- `npx vitest run` passes completely (root).
- `npx tsc --noEmit` clean at the root and in `web/`.
- Do not start a dev server.
