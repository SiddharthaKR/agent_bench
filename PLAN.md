# Agent Bench: plan and progress

Last updated: 2026-11-14. "Agent Bench" is a working name.

## Goal

A light app that lets local models (Gemma 4 and others, on LM Studio or Ollama) do real hardware coding: FPGA, DPU, GPU. The model's context is spent on the task, not on the harness. Linux is the target; development happens on the Windows PC and real-model runs happen on the office server.

It replaces opencode, which scored 0 of 16 on the FPGA harness. The failures there were mostly tool-call plumbing (lost `filePath`, exact-text edit loops, wasted context), not the model's coding ability.

## Rules that keep it light

1. Small fixed prompt. The system prompt plus tool instructions stay short and their size is recorded on every run.
2. Few tools per agent (four to six), each with short output.
3. No layers between the agent and the model. The app talks directly to the model server and reads tool calls from the model's text.
4. Sub-agents work in a fresh context and return a short summary.
5. Old tool output is trimmed from the context.
6. A loop guard blocks repeated calls and repeating cycles before the tool runs.
7. Pass or fail comes from a command's result, never from the agent saying "done".

## Parts

- **Engine** (`src/`): runs an agent from a folder, runs workflows, writes the trace. Usable from the command line and from code.
- **Local server**: file tree, file read and write, session start, steer and stop, event stream to the browser.
- **Browser app**: Work, Workflows, Trace and Agents screens. Lab (Results, hidden judge) sits behind one setting and is removed for the team version.

Everything is customizable two ways: through the GUI, and through files and code. An agent is a folder (`agents/<name>/agent.json` and `prompt.md`). Workflows and skills will be files too, and a run is a function (`runAgent`) that scripts can call.

## Decisions made

| Topic | Decision |
|---|---|
| Repository | New and separate, at `Documents\Personal\Harness`. No code copied from learnharness (AGPL). |
| Agent library | `@earendil-works/pi-agent-core` 1.4.0 (MIT) |
| Browser framework | React with Vite |
| How the model edits files | Whole-file write plus replace-by-line-range |
| Approval default | Ask before edits and commands, switchable per agent |
| Shell access | Named tools only; a general "run command" tool is opt-in per agent |
| Orchestrator | Plain code runs workflow steps in order; the model is used only inside agent steps |
| Bench | Removed as a screen. Lab is "run a workflow several times, score it with the hidden judges, list the results". |
| Look | Minimal, using the learnharness colour scheme (near-white neutrals, one indigo accent, dark greys in dark theme, Inter) |
| Way of working | Build on the Windows PC, verify with a scripted fake model and local Ollama models; the owner runs the server tests |

## Workflow design (agreed)

- A workflow is an ordered list of typed steps: an agent step or a command step.
- Two fix loops. Inner: the agent fixes compile errors inside its own step. Outer: when a later check fails, the orchestrator restarts the fixing agent with a fresh context holding the spec, the current file, a short failure report and one line per earlier attempt.
- Each step has an "on fail" rule (go back to step N, at most K rounds), then hands over to the user, who can steer, edit and resume from a step.
- Settings live on the step: model, temperature, context limit, tool list, on-fail rule.
- Each agent ships with a ready-made default workflow to copy and edit.
- The format stays open for later step types (for example parallel candidates and a pick step). These are not built or shown now.

## Milestones

| # | Milestone | Status |
|---|---|---|
| 0 | Command-line spike: FPGA agent, five tools, direct to the model server, trace to disk | **Built and verified locally. Server go or no-go run still to do.** |
| 1 | Engine: sub-agents, both fix loops, workflow runner, context trimming, approval hook, per-step settings, code API | Not started |
| 2 | Work screen: file tree, editor with autosave and Ctrl+S, change accept and reject, chat with stop and steer, dark theme | Not started |
| 3 | Workflows screen with the graph | Not started |
| 4 | Trace: click-to-expand thinking in chat, plus the full Trace screen | Not started |
| 5 | Agents screen, per-step settings, MCP servers, DPU agent | Not started |
| 6 | Lab results, then the Linux install script for the team version | Not started |

Milestone 0 is the go or no-go point. If Gemma 4 26B still fails on the server with clean tool calls, the problem is the model or the prompts and the rest of the plan changes.

## Milestone 0: what exists

- `src/protocol.ts`: the tool-call text format and its parser.
- `src/model.ts`: talks to an OpenAI-compatible server with plain chat messages, streamed.
- `src/tools/`: `read_file`, `write_file`, `replace_lines`, `compile`, `run_sim`.
- `src/guard.ts`: loop guard. `src/trace.ts`: trace writer.
- `src/agent.ts`: `runAgent`. `src/cli.ts`: command line.
- `agents/fpga/`: the FPGA agent. `config.json`: model servers and compile commands.
- `test/`: 115 tests, all passing on 2026-11-14.

Tool-call format (no JSON, so the model never escapes code):

```
@tool write_file
path: rtl/gain.v
---
module gain;
endmodule
@end
```

### Verified on the Windows PC, 2026-11-14

- 115 of 115 tests pass, type check clean.
- Real run with Gemma 4 E4B on Ollama and real Icarus Verilog: 41 model calls, 41 tool calls, 0 unreadable, 0 blocked. Starting context about 494 tokens.
- That small model did not solve the test task (a saturating gain block) within the 40-call limit.
- Qwen3 8B: not completed. One reply took over five minutes; not re-run after the streaming fix.

### Found with the real model and fixed

- The model copied an empty `---` onto calls that take no text. The instructions now show two real examples and an empty section is accepted.
- A stop sequence cut the model off during its thinking and left an empty reply. The stop sequence is removed and an empty reply is never treated as finished.
- Node drops a request after five minutes without a reply. Replies are now streamed.
- A compile error now shows the offending source line.

### Still to do for milestone 0

- [ ] Set the LM Studio model id for `office` in `config.json`.
- [ ] Get the repository onto the server (first commit and a remote, or a folder copy).
- [ ] Run task H easy three times on the server with Gemma 4 26B and score it with the existing hidden judges. Compare with opencode's 0 of 16.
- [ ] Check on the server: which effort or thinking setting Gemma 4 accepts on LM Studio, and whether it handles parallel requests.

## Open points

- The agent prompt (`agents/fpga/prompt.md`), the tool-call format and the limits (40 tool calls, block on the third repeat) were chosen during the spike and are the owner's to change.
- Context grew from about 0.5k to 15k tokens over 41 calls. Trimming is milestone 1.
- Whether Results should compare workflows instead of agent setups.
- Per-step settings are not yet shown on the step cards in the UI prototype.

## UI prototype

A clickable prototype with dummy data shows the target screens: https://claude.ai/artifact/3H83kZxtnRrojfDDgahqYd (private to the owner). The real screens are built to match it.

## How to run

```bash
npm test
```

```bash
npm run agent -- --folder <project folder> --task "<what to do>"
```

```bash
npm run agent -- --server office --folder <project folder> --task-file <task.md>
```

Each run prints its steps and writes a trace under `runs/`.
