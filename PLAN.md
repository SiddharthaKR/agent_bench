# Agent Bench: plan and progress

Last updated: 2026-11-15. "Agent Bench" is a working name. Read this file first in a new session.

## Goal

A light app that lets local models (Gemma 4 and others, on LM Studio or Ollama) do real hardware coding: FPGA, DPU, GPU. The model's context is spent on the task, not on the harness. It replaces opencode, which scored 0 of 16 on the old FPGA harness, mostly because of tool-call plumbing.

Linux is the target. Development happens on the Windows PC; the office server (172.20.1.126) runs it in development mode only: started by hand, no deployment.

## Where things are

- Repository: `C:\Users\siddh\Documents\Personal\Harness`, GitHub `SiddharthaKR/agent_bench`.
- Branch `master`: milestone 0 only (pushed).
- Branch `ui-work-workflows`: everything since (committed locally, **not pushed**).
- Old harness with the hidden judges: `C:\Users\siddh\Documents\Personal\DUMP\ai_demo`. Never read or copy `harness/judge/` into anything an agent can see.
- UI prototype (dummy data, the look to match): https://claude.ai/artifact/3H83kZxtnRrojfDDgahqYd

## How the work is done

- The owner holds design authority. Ask before guessing a design decision.
- Codex (`codex exec -s workspace-write`) builds parts from written briefs in `briefs/`; each brief lists the files it may touch so parallel tasks do not collide. The result is then read, tested and checked in the browser before it is committed.
- Scoring runs use a frozen copy of the code so later edits cannot disturb them.
- Commits end with the Co-Authored-By line. Pushes need the owner's approval each time.

## Rules that keep it light

1. Small fixed prompt; its size is shown on the Agents screen and recorded in every trace.
2. Few tools per agent, each with short output.
3. No layers between agent and model: plain chat to the model server, tool calls read from the model's text.
4. Sub-agents work in a fresh context and return a short summary.
5. Old tool output and old file text are trimmed from the context.
6. A loop guard blocks repeated calls and cycles, and notices a result that does not change.
7. Pass or fail comes from a command's result, never from the agent saying "done".
8. A run has a time limit; an easy task must finish in a decent time or be retried.

## Decisions made

| Topic | Decision |
|---|---|
| Agent library | `@earendil-works/pi-agent-core` 1.4.0 (MIT). No code from learnharness (AGPL). |
| Browser app | React with Vite; CodeMirror editor; system fonts; the learnharness colour scheme |
| Tool-call format | Plain lines (`@tool name`, `key: value`, `---`, text, `@end`), no JSON |
| Edits | Whole-file write, plus replace-by-line-range for files over 150 lines |
| Approval | Ask before edits by default; switch on the Work screen |
| Shell access | Named tools only; no general "run command" tool yet |
| Orchestrator | Plain code runs workflow steps; the model works only inside agent steps |
| Customisation | Everything is files and code as well as GUI: `agents/<id>/`, `workflows/*.json`, `src/index.ts` |
| Bench | No Bench screen. Lab = scored runs listed on the Results screen, behind the "Lab tools" switch |
| Server | Development mode only (`docs/server.md`); no installer or service for now |
| Settings | `config.json` is shared; `config.local.json` (not committed) holds per-machine values |

## Milestones

| # | Milestone | Status |
|---|---|---|
| 0 | Command-line agent, five tools, trace to disk | Done. Server run with the 26B model still to do |
| 1 | Engine: skills, context trimming, guards, time limit, sub-agents, workflow runner, per-step settings, code API | Built, tests pass |
| 2 | Work screen: files, editor with autosave and Ctrl+S, change review, chat with stop and steer | Built, checked in the browser with local Gemma |
| 3 | Workflows screen: step cards, graph, run controls | Built, checked in the browser |
| 4 | Trace screen | Built, checked in the browser |
| 5 | Agents screen; DPU and GPU agents; MCP servers | Screen and agents built and checked; MCP built, tests pass, card not checked in the browser |
| 7 | FPGA accuracy and speed (owner's top priority) | In progress: see the accuracy section |
| 6 | Results (Lab), medium task, server development mode | Built; scripts not yet run end to end since the rewrite |

## What exists (branch `ui-work-workflows`)

- **Engine** (`src/`): `agent.ts` (`runAgent`), `session.ts` (interactive chat with approvals and steering), `workflow.ts` (runner), `subagent.ts` (`ask_agent`), `skills.ts`, `context.ts` (trimming), `guard.ts`, `protocol.ts`, `model.ts` (streamed chat, extra request settings per server), `tools/`, `trace.ts`, `traces.ts`, `results.ts`, `config.ts`, `engine.ts`, `index.ts` (code API).
- **Server** (`src/server/`): local HTTP server, 127.0.0.1 by default, `--host` to open it on a trusted network.
- **Browser app** (`web/`): Work, Workflows, Trace, Agents, and Results (Lab).
- **Agents** (`agents/`): `fpga` (two skills, sub-agents `testbench` and `verifier`), `dpu`, `gpu`.
- **Workflows** (`workflows/`): `fpga-block.json` (write, compile, testbench, simulate) and `retry-until-pass.json` (write, check, retry with a fresh start).
- **Command lines:** `npm run agent`, `npm run workflow`, `npm run app`, `npm run result`.
- **Scoring:** `scripts/eval_local.sh` (local gain task) and `scripts/h_task.sh <ai_demo> <easy|medium>` (old harness with its hidden judge); results go to `runs/results.jsonl`.
- **Docs:** `README.md`, `docs/server.md`, `examples/`.
- **Tests:** 266 passing at the last full run (2026-11-15), type checks clean.

## Accuracy of the small local model (Gemma 4 E4B on Ollama)

Task: write a saturating gain block and make a given testbench pass. Verdict from an independent check with the original testbench.

| When | Setup | Passed |
|---|---|---|
| 2026-11-14 | Milestone 0 harness, 40-call limit | 0 of 2 |
| 2026-11-15 | After the accuracy work, thinking on, 300 s | 2 of 3 |
| 2026-11-15 | Same plus sub-agents and the fixed-point skill line, thinking on | 1 of 3 |
| 2026-11-15 | Same, thinking off (`local-fast`) | 2 of 4 |
| 2026-11-15 | Retry workflow, 150 s (the retries never ran: the first time-out ended the run) | 1 of 4 |
| 2026-11-15 | Latency rule only, thinking off, 120 s | 1 of 4 |
| 2026-11-15 | Latency rule only, thinking on, 150 s | 2 of 4 |
| 2026-11-15 | Commit 44c15ea, single agent, thinking off, 120 s | 3 of 4 (fastest pass 30 s) |
| 2026-11-15 | Commit 44c15ea, `fpga-fast` workflow | **4 of 4** (16, 18, 20 and 211 s) |

Two more local tasks since commit 44c15ea, `fpga-fast` workflow:

| Task | Level | Passed | Time per run |
|---|---|---|---|
| `counter` (up/down counter with load and wrap flag) | easy | 3 of 3 | 14, 18, 50 s |
| `fir4` (4-tap FIR, Q7 coefficients, saturation, valid) | medium | 2 of 3 | 63, 203 s; the failure used all three attempts (394 s) |

After the prompt fix (a given testbench is the judge), protected files and three more hints:

| Commit | Task | Setup | Passed | Time per run |
|---|---|---|---|---|
| f44f553 | gain | single agent, thinking off | 4 of 4 | 13, 18, 19, 24 s |
| f44f553 | fir4 | `fpga-fast` workflow | 3 of 4 | 41, 147, 318 s |
| f44f553 | fir4 | single agent, thinking off, 150 s | 2 of 3 | 36, 79 s |
| 5c90232 | fir4 | `fpga-fast` workflow | **4 of 4** | 30, 35, 80, 138 s |
| 5c90232 | gain | `fpga-fast` workflow | 3 of 3 | 13, 14, 74 s |
| 5c90232 | counter | `fpga-fast` workflow | 3 of 3 | 11, 11, 15 s |
| 5c90232 | counter | single agent, thinking off | 3 of 3 | 13, 13, 21 s |

**Overfitting caution.** These three tasks are the tuning set: skills and hints were adjusted by reading their failures, the fixed-point skill's worked module is close to the gain task, and samples are 3 or 4 runs. A held-out set of six other tasks (`pwm`, `seqdet`, `regbank`, `fifo`, `accum`, `uart_tx`) is only measured, never tuned against; the old harness's easy and medium tasks with the hidden judge are the second independent check.

**Held-out set, commit 6eea7a1, `fpga-fast` workflow, two runs each (measured only, not tuned against):**

| Task | Level | Passed | Seconds per run (average) |
|---|---|---|---|
| pwm | easy | 2 of 2 | 20 |
| seqdet | easy | 2 of 2 | 127 |
| accum | medium | 2 of 2 | 114 |
| fifo | medium | 2 of 2 | 194 |
| regbank | medium | 1 of 2 | 273 |
| uart_tx | medium | 0 of 2 | 342 |

Held-out total 9 of 12 (easy 4 of 4, medium 5 of 8), against 10 of 10 on the tuning set with the same commit family. So the gains carry over to other kinds of blocks, with a gap on medium tasks.

**Old harness, easy task, hidden judge, commit 5c90232, single agent, 300 s: 0 of 4.** The task is bigger than the local ones (register bus, own testbench, report). One run had the data path right (16 of 16 cases) and failed 3 of 8 register read-back checks; the time went into rewriting a long testbench. Four general fixes and a design-then-testbench workflow followed (commit 8187fa5); rerun pending.

What the traces of failed runs showed, and the fix for each (all 2026-11-15):
- Retries never happened after a time-out. Fixed: time limit per agent step; a stopped step goes on to the checks.
- Intermediate values registered, so the output was late. Fixed: latency rule, worked module in the fixed-point skill, "late output" hint.
- A shadow register (`dout_reg`) assigned instead of the output port, every test `x`. Fixed: lint hint naming the undriven output.
- Rounding added although the spec said truncate (copied from the old skill example). Fixed: the example truncates.
- The given testbench overwritten by the model. Fixed in the prompt; a harness refusal ("protected files") is being built.
- FIR: `16'sd-32768` (syntax), limits declared unsigned so every result saturated. Rule added; hints being built.

What changed the result earlier:
- Files under 150 lines are rewritten whole (before, stale line-range edits grew a file to 225 broken lines).
- Context stays between 1.5k and 6.3k tokens (before, 15k to 28k).
- The same failing result three times tells the model to re-read and rewrite.
- A short always-on Verilog rules skill; a fixed-point skill loaded on request; hints under known compiler errors.

What still fails on E4B: declarations inside `always` blocks (thinking off), an extra register that delays the output one cycle (thinking on), and long thinking that eats the time limit. Ollama accepts `reasoning_effort: "none"` to switch thinking off; `"low"` made no difference.

All numbers are for E4B. The real target, Gemma 4 26B on the server, has not been run with this harness.

## Next steps

Priority set by the owner on 2026-11-15: **accuracy and speed of FPGA work first**; MCP and other extras are low priority. His goal in his words: "produce correct, industry level, speed, fpga code workflow using this tool for local models by repetitive improvement".

The improvement loop: measure on a tuning set, read the failed runs, make a general fix (rule, hint, check, workflow), re-measure, then confirm on tasks that were not used for tuning. Three measures:
1. Our nine tasks: three tuning, six held-out (`scripts/eval_set.sh`).
2. The old harness's easy and medium tasks with the hidden judge (`scripts/h_task.sh`).
3. NVlabs VerilogEval, split into dev and held-out (`scripts/verilog_eval.sh`, brief T, being built).

"Industry level" is measured separately from pass or fail by a quality gate (brief U, being built): latches, blocking and non-blocking misuse, multiple drivers, plus Verilator and Yosys where installed.

**Where the session stopped (2026-11-15, about 13:40, usage limit):**
- Old harness easy task: 0 of 5 more runs. Single agent: data path right in most runs (16 of 16 cases), register read-back wrong (sign extension, unknown addresses, the constant). The three `fpga-design-tb` workflow runs were **invalid**: on Windows the multi-line `--task` text was cut at its first line and the `--var` paths after it were dropped, so the run used `rtl/design.v`. Fixed (`--task-file` for the workflow command line, used by `h_task.sh`), tests pass, **not yet rerun**.
- Also fixed, not yet measured: a step's `tools` list may name `use_skill` and `ask_agent`; the design step of `fpga-design-tb` no longer has `run_sim` or sub-agents on its first round (it wasted its time limit calling them).
- Next: rerun `bash scripts/h_task.sh <ai_demo> easy local -n 3 -t 180 -w workflows/fpga-design-tb.json` from a frozen copy; then decide about listing the `bus-registers` skill and adding a "check the design against every spec line" step, since read-back is where the real task and the held-out `regbank` task fail.
- Comment-policy and skill-set comparisons are not done.

**Later the same day (about 16:20):**
- Codex tasks S, T, U are built, verified and committed (448 tests): `ask_user`, the VerilogEval runner, `npm run quality`. VerilogEval is cloned into `external/` (not committed), 39 dev and 117 held-out problems; the judge passes the benchmark's references.
- Old harness easy, valid reruns, all with Gemma 4 E4B: `fpga-design-tb` workflow 0 of 3 (about 630 s each, data path right twice, read-back wrong, every step ran to its limit); single agent with the new `bus-registers` skill 0 of 3 (one run had read-back 8 of 8 but data path 10 of 16; one had the judge's COMPILE_ERROR although the model's own simulation ran).
- Reading across all old-harness runs: the model gets the data path right in most runs and the read-back right when it loads the bus skill, but not yet both in one run, and its own testbench costs most of the time and often does not compile. E4B is at its limit on this task; the 26B model on the server is the real target and has not been run.
- In progress: VerilogEval dev run (39 problems, single agent, thinking off); Codex task V (module header checked against the spec, two compile hints).
- Idea to put to the owner: a co-simulation tool that checks a streaming block against the task's bit-true Python model, so the small model does not have to write its own testbench.

**VerilogEval dev set (39 problems, Gemma 4 E4B, single agent, thinking off), 2026-11-15:**

| Code | Passed | Median s | Out of time | Note |
|---|---|---|---|---|
| 9e002d9 (before the testbench changes) | 22 of 39 (56%) | 115 | 12 | The model wrote testbenches nobody asked for; an XNOR gate took 51 s |
| a709768 (design-first prompt only) | 19 of 39 (49%) | 64 | 12 | Still wrote testbenches on harder problems and damaged correct designs |
| d3f34dc (harness refuses a testbench the task does not ask for) | **24 of 39 (62%)** | **17** | 0 | 13 wrong output, 1 compile error, 1 judge error |

| d3f34dc, thinking **on** | 22 of 39 (56%) | 28 | 1 | No gain from thinking on first-shot design, about 60% slower; thinking off stays the default |
| ce113d7 (interface check reads bullet-list ports; rules: exact ports, concatenation order) | 25 of 39 (64%) | 15 | 0 | No compile error at the judge any more |
| dba1fbf (state-machine method in `reset-and-state`, offered by default) | **26 of 39 (67%)** | 17 | 0 | 10 wrong output, 1 compile error, 1 no file, 1 judge error (runner mislabels a mismatch) |

Each step up of one or two problems is within run-to-run variation; the trend over five runs and the sixfold speed gain are not.

Tuning set with d3f34dc, `fpga-fast`, two runs each: gain 2 of 2, counter 2 of 2, fir4 2 of 2.

Old harness easy with dba1fbf, single agent, three runs: 0 of 3, but for a new reason. The model went through design, generated testbench, checks and report in about 80 s and **never compiled**; the judge got a file with errors. Fix: before a run may end, the harness compiles the Verilog files changed since their last compile and hands a failure back to the model (up to two rounds).

Owner's steer (2026-11-15): help the testbench writer, but the testbench matters little when the RTL is right. Built for that: `tb_skeleton` (generates a compiling testbench from the design's ports), `tb_checks` (fills only the checks), testbench hints, the design protected during the testbench step, and the rule above.

What the 15 remaining dev failures are: a renamed port and a changed width (2), a wrong concatenation order (1), the rest wrong logic in state machines, Karnaugh maps and cellular automata. In progress: interface check for port lists written as bullets (Codex task X), two rule lines (exact ports, concatenation order), the same set with thinking on.

Queued for Codex at 15:16 on 2026-11-15 (done), in order: S (agent asks the user instead of guessing), T (VerilogEval runner), U (quality gate).

- [x] Retry-workflow score read (1 of 4, retries were broken); fixed and re-measured (4 of 4 on gain with `fpga-fast`).
- [x] MCP servers (Codex task K) committed; tests pass. Its card on the Agents screen is not yet checked in the browser (low priority).
- [ ] Codex tasks P and O: protected files, three more hints, topic skills ported from the old harness, skill preloading (`--skills`, step `skills`). Verify, commit.
- [ ] Score again on gain, counter and fir4 after P; aim: easy tasks pass every run in under a minute, fir4 passes 3 of 3.
- [ ] Comparisons, change a default only where the numbers are better: comments (current, header only, none); short skills against the ported descriptive topic skills; `plan-first`.
- [ ] Run `scripts/h_task.sh` for easy and medium on this PC to confirm the scripts work end to end.
- [ ] Try the sub-agents and the code-API examples against the real model.
- [ ] Owner: look at the screens at desktop size and say what to change in the look.
- [ ] Owner: on the server, follow `docs/server.md`, then run `bash scripts/h_task.sh /path/to/ai_demo easy office <model id> -n 3` and the same with `medium`.
- [ ] Push `ui-work-workflows` when the owner approves.

## Open points

- The agent prompt, the tool-call format and the limits (40 tool calls, 150-line rule, time limits) were chosen during the build and are the owner's to change.
- DPU and GPU agents have prompts and skills but no domain tools (quantize, compile, benchmark) yet.
- Sub-agent edits are not individually approved; the `ask_agent` call is approved once.
- No general "run command" tool; a Python step is possible only as a workflow command step.
- "Open in Trace" from a step on the Work screen is not built.
- Later ideas the format leaves room for, not built: parallel candidates with a pick step, per-sub-agent models.

## How to run

```bash
npm test
```

```bash
npm run web:build
```

```bash
npm run app -- --folder <project folder>
```

```bash
npm run agent -- --folder <project folder> --task "<what to do>"
```

```bash
npm run workflow -- --workflow workflows/retry-until-pass.json --folder <project folder> --task "<what to do>" --var design=rtl/top.v --var tb=tb/tb_top.v --no-pause
```

```bash
bash scripts/eval_local.sh -n 3 -t 300
```

```bash
bash scripts/h_task.sh /path/to/ai_demo easy office <model id> -n 3
```
