# Task H: the Agents screen, and DPU and GPU agents

Read `briefs/common.md` first and follow it, with this change to its file rule: in this task you OWN and may edit `src/server/**` (including `main.ts`), `web/src/App.tsx`, `web/src/api.ts`, `web/src/workflows/**`, and you create `src/shared/agents.ts`, `src/agent-store.ts`, `web/src/agents/**`, `agents/dpu/**`, `agents/gpu/**`, and tests. Do NOT touch `src/agent.ts`, `src/session.ts`, `src/engine.ts`, `src/workflow.ts`, `src/model.ts`, `src/tools/**`, `src/shared/api.ts`, `src/shared/engine.ts`, `agents/fpga/**`, `agents/testbench/**`, `agents/verifier/**`, `web/src/work/**`, `web/src/trace/**`, `web/src/theme.css`.

Read first: `src/agent.ts` (`AgentFile`, `loadAgent`), `src/skills.ts`, `src/tools/index.ts` (`ALL_TOOLS`), the existing agent folders under `agents/`, `web/src/workflows/StepCard.tsx`.

## Purpose

An agent is a folder: `agents/<id>/agent.json`, `prompt.md`, and optional `skills/*.md`. The user wants to add an agent (FPGA, DPU, GPU, ...) and choose its tools, skills and sub-agents without writing code, and still be able to edit the same files by hand. This screen edits those files. Nothing is stored anywhere else.

## Server side

- `src/shared/agents.ts` (types only):
  ```ts
  export interface SkillInfo { name: string; description: string; always: boolean; enabled: boolean; }
  export interface ToolInfo { name: string; summary: string; enabled: boolean; }
  export interface AgentDetail {
  	id: string; name: string; prompt: string;
  	tools: ToolInfo[];            // every tool the app has, with enabled flags
  	skills: SkillInfo[];          // every skill file in the agent's folder
  	subagents: { id: string; name: string; enabled: boolean }[];   // every other agent
  	maxTurns: number; maxSeconds: number | null; smallFileLines: number; trimContext: boolean;
  	promptChars: number;          // size of the full system prompt as the model gets it
  }
  export interface AgentUpdate { name: string; prompt: string; tools: string[]; skills: string[]; subagents: string[]; maxTurns: number; maxSeconds: number | null; smallFileLines: number; trimContext: boolean; }
  ```
- `src/agent-store.ts`: `listAgentDetails(agentsDir)`, `readAgentDetail(agentsDir, id)`, `saveAgent(agentsDir, id, update)`, `createAgent(agentsDir, id, name)`, `deleteAgent(agentsDir, id)`.
  - Ids match `^[a-z0-9][a-z0-9_-]{0,31}$`. Create fails if the folder exists. A new agent gets `read_file` and `write_file`, an empty skills list, and the prompt `Describe what this agent is for and how it should work.`
  - Save writes `agent.json` (tabs, trailing newline; keep any unknown keys already in the file) and `prompt.md`. It validates: non-empty name; tools exist in `ALL_TOOLS`; skills exist as files; sub-agents exist and are not the agent itself; `maxTurns` 1..200; `maxSeconds` null or 30..7200; `smallFileLines` 0..2000. Each failure is a clear sentence.
  - Delete removes the folder; refuse to delete the last agent, and refuse when another agent lists it as a sub-agent (name that agent).
  - `promptChars` comes from `loadAgent(...).systemPrompt.length`.
- Routes (`createAppServer` gets an option `agentsDir`; `main.ts` passes `<repo>/agents`):
  - `GET /api/agents` -> `AgentDetail[]`; `GET /api/agents/:id` -> `AgentDetail`
  - `POST /api/agents` `{ id, name }` -> `AgentDetail`
  - `PUT /api/agents/:id` `AgentUpdate` -> `AgentDetail`
  - `DELETE /api/agents/:id` -> `{ ok: true }`
  - Validation failures -> 400 with the sentence; unknown id -> 404 `No such agent.`
- Tests for the store (temp dirs) and the routes.

## Two more agents

Create `agents/dpu` and `agents/gpu` so the user sees how a second domain is added. Keep each prompt at most 80 words and general.
- `dpu`: name `DPU agent`. For preparing neural networks for an FPGA DPU: quantize first, then compile, report accuracy before and after, never claim a number that was not measured. Tools: `read_file`, `write_file`, `replace_lines`. One skill `dpu-deploy-flow.md` (`always: false`, at most 200 words): the usual order (float model check, calibration data, quantize, compile for the target, run on the board, compare accuracy), common failure causes (unsupported operators split the graph, calibration set too small), and what to report.
- `gpu`: name `GPU agent`. For writing and speeding up GPU kernels: check the output against the CPU reference before measuring speed, never report a speedup that was not measured. Tools: `read_file`, `write_file`, `replace_lines`. One skill `gpu-kernel-practice.md` (`always: false`, at most 200 words): batch work to avoid per-item kernel launches, memory layout and transfers, measuring correctly (warm-up, synchronise before timing).
These agents have no domain tools yet (compile and run tools for those domains come later). Do not mention that in the prompts; mention it in your final report.

## Browser side

- `web/src/api.ts`: `agents()`, `agent(id)`, `createAgent(id, name)`, `saveAgent(id, update)`, `deleteAgent(id)`.
- `web/src/App.tsx`: add a tab `Agents` after `Trace`, rendering `<AgentsScreen {...props} onChanged={reloadConfig} />`; add a `reloadConfig` function that fetches `/api/config` again so the header's agent list updates after a change. Change nothing else in the shell.
- `web/src/agents/AgentsScreen.tsx` (+ `agents.css`, pure helpers in `logic.ts` with tests):
  - Left column (240px, `card`): label `Agents`, one button per agent (name, and small muted `<n> tools · <m> skills`), selected one highlighted; under it a dashed `Add agent` button that reveals a small form: `Id` (lowercase letters, digits, dashes), `Name`, `Create`, `Cancel`.
  - Right: header row with `<h1>Setup: <name></h1>`, the folder path `agents/<id>/` (mono, muted), a pill `Saved` / `Unsaved` (`warn`), and small muted text `System prompt: <promptChars> characters` (this is the context the agent costs before any work; it updates after each save).
  - A responsive grid of cards (min 300px each):
    - `Basics`: `Name` input; `Most tool calls per run` number; `Time limit, seconds` number (empty = no limit); `Rewrite whole file under this many lines` number; checkbox `Trim old tool output from the context`.
    - `Tools`: one checkbox row per tool: name (mono, medium) and summary (small, muted).
    - `Skills`: one checkbox row per skill: name, description, and a small tag `always in the prompt` or `loaded on request`. Empty: `No skills in this agent's folder. Add a Markdown file under agents/<id>/skills/.`
    - `Sub-agents`: one checkbox row per other agent. Empty: `No other agents yet.`
    - `System prompt`: a textarea (mono, 10 rows) for `prompt.md`.
  - Edits save automatically 800 ms after the last change (`PUT`), like the Workflows screen. A validation error from the server is shown in `tone-bad` under the header and the pill stays `Unsaved`.
  - `Delete agent` (`btn btn-danger`, with `window.confirm`), at the bottom right.
- Workflows screen, step editor (`web/src/workflows/StepCard.tsx` and its logic): for an agent step add four optional fields under a small label `Settings for this step`: `Model` (text, placeholder `server default`), `Temperature` (number, step 0.1, placeholder `server default`), `Most tool calls` (number, placeholder `agent default`), and `Tools` (checkboxes of the chosen agent's tools; all unchecked means "the agent's own tools" and stores no `tools` key). Empty fields remove the key from the step. Keep the workflow autosave working.

## Verify

- `npx vitest run` passes completely (root).
- `npx tsc --noEmit` clean at the root and in `web/`.
- Do not start a dev server.
