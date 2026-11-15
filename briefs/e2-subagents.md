# Task E2: sub-agents, per-step settings, code API

Read `briefs/common.md` first and follow it, with this change to its file rule: in this task you OWN and may edit `src/agent.ts`, `src/session.ts`, `src/engine.ts`, `src/workflow.ts`, `src/cli.ts`, `src/cli-workflow.ts`, `src/tools/**`, `agents/**`, and their tests, and you create `src/subagent.ts`, `src/index.ts`, `examples/**`. Do NOT touch `src/server/**`, `src/shared/**`, `src/model.ts`, `web/**`.

Read the current `src/agent.ts`, `src/session.ts`, `src/engine.ts`, `src/workflow.ts`, `src/skills.ts`, `src/context.ts` first: they changed recently.

## 1. Sub-agents (`src/subagent.ts`)

A sub-agent keeps the main agent's context small: the main agent hands over one piece of work, the sub-agent does it in a fresh context, and only a short summary comes back.

- `agent.json` may have `"subagents": ["<agent id>", ...]`: other agent folders (siblings under the same agents folder) this agent may call.
- When the list is non-empty the agent gets one extra tool, `ask_agent`: arg `agent` (required, one of the listed ids), body = the task text for it (required). Its summary line: `Hand a piece of work to another agent. It starts fresh and returns a short summary.` The tool help must list the available ids with each agent's `name`.
- Running it: `runAgent` for that agent folder with the same workspace, server, commands, exec, fetch and runs folder, the remaining time limit if one is set, and `depth + 1`. A sub-agent never gets `ask_agent` itself (depth limit 1). Its result text is `<agent name> finished: <final text>` (final text cut to 1500 characters) or, when it did not end with `done`, an error result `<agent name> could not finish (<reason>). <final text or error>`.
- The sub-agent's tool-call lines are forwarded to the caller's `onStep` with a two-space indent and the agent id in front. Its trace is its own run folder; add a `subagent` event to the caller's trace with the agent id, the task's first 200 characters, the reason and the sub-run's trace folder.
- It works in both `runAgent` and the interactive session (in the session, each forwarded line is emitted as a `note` event with tone `info`).
- `ask_agent` is not an edit; edits made by the sub-agent are NOT individually approved in this version. In the session, when "ask before edits" is on, the `ask_agent` call itself waits for approval once, shown as a `proposal` with path `ask_agent: <agent id>`, `isNew: true` and the task text as added lines. Reuse the existing approval path.
- Add two sub-agents for FPGA work as agent folders: `agents/testbench` (name `Testbench writer`, tools `read_file`, `write_file`, `compile`, `run_sim`; prompt: writes a self-checking Verilog testbench from the spec and the module's port list only, prints one PASS or FAIL line per check, ends with $finish, never edits the design) and `agents/verifier` (name `Verifier`, tools `read_file`, `run_sim`; prompt: reads the spec and the latest simulation result and reports, in at most 8 lines, which requirement fails and the most likely cause; it never edits files). Both prompts at most 70 words. Set `"subagents": ["testbench", "verifier"]` in `agents/fpga/agent.json`, and add one line to the fpga prompt saying when to use them.

## 2. Per-step settings in workflows

`AgentStep` (see `src/shared/api.ts`) now has optional `model`, `temperature`, `maxTurns`, `tools`.

- `RunOptions` of `runAgent` gets `overrides?: { maxTurns?: number; tools?: string[] }`. `tools` must be a subset of the agent's tools (unknown names -> the run fails at start with a clear sentence); the tool help and the registered tools both shrink to it.
- In `src/engine.ts` and `src/cli-workflow.ts`, an agent step's `model` and `temperature` replace the server's values for that step, and `maxTurns` / `tools` go into `overrides`.
- `validateWorkflow` rejects `temperature` outside 0..2, `maxTurns` < 1, and an empty `tools` array.

## 3. Code API (`src/index.ts`)

The owner wants to drive everything from code as well as from the GUI.

- Export, with their types: `runAgent`, `loadAgent`, `createSession`, `createWorkflowRun`, `validateWorkflow`, `fillPlaceholders`, `loadConfig`, `createEngine`, `loadSkills`, `trimContext`, `LoopGuard`, `realExec`, and the shared types from `src/shared/api.ts`.
- Add a helper `runWorkflow(options): Promise<WorkflowRunState>` in `src/index.ts` or a small new file: `{ root, workflow: Workflow | string (path to a JSON file), folder, task, server?: string (default "local"), model?, vars?, onEvent?, autoContinue?: boolean (default true) }`. It builds the deps the same way `src/cli-workflow.ts` does (move the shared part into one function both use), starts the run, continues past pauses when `autoContinue` is true, and resolves with the final state when the status is `done`, `failed` or `stopped` (or `paused` when `autoContinue` is false).
- `examples/run-workflow.ts`: a 25-line script using `runWorkflow` on `workflows/fpga-block.json`, printing each state change. `examples/custom-workflow.ts`: builds a `Workflow` object in code (two steps: an agent step and a command step with `onFail`) and runs it. `examples/README.md`: 12 lines on how to run them with `npx tsx`.

## Tests

- Sub-agents: tool appears only when configured; help lists ids and names; a scripted fake model drives a main agent that calls `ask_agent`, the fake answers for the sub-agent, and the summary comes back as the tool result; unknown agent id -> error result; a sub-agent has no `ask_agent`; a sub-agent that hits a limit reports `could not finish`; the session emits notes for sub-agent lines and asks once when asking is on.
- Overrides: tool subset applied to both help and execution; unknown tool name fails clearly; engine passes step model and temperature (check the request body the fake model receives).
- `runWorkflow`: straight pass with fake exec and fake fetch; `autoContinue` false stops at a pause.
- Existing tests keep passing.

## Verify

- `npx vitest run` passes completely.
- `npx tsc --noEmit` is clean (root). The examples must type-check: include `examples` in the root `tsconfig.json` `include` (you may edit that one line).
