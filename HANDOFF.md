# Handoff: where the work stands and what comes next

Written 2026-11-16. Read this first, then `PLAN.md` for the full history and tables. "Agent Bench" is a working name.

## Goal (owner's words)

"Produce correct, industry level, speed, fpga code workflow using this tool for local models by repetitive improvement."

Priorities he set, in order: correct RTL first; speed; the testbench matters little when the RTL is right; MCP and other extras are low priority.

## Where everything is

- Repository: `C:\Users\siddh\Documents\Personal\Harness`, GitHub `SiddharthaKR/agent_bench`.
- Branch `master`: milestone 0 only (pushed). Branch `ui-work-workflows`: everything else, committed locally, **not pushed**. A push needs the owner's approval.
- Old harness with hidden judges: `C:\Users\siddh\Documents\Personal\DUMP\ai_demo`. Never open `harness/judge`.
- VerilogEval: cloned into `external/verilog-eval` (not committed), commit c498220; 39 dev and 117 held-out problems.
- Run folders and recorded results: `runs/` (not committed). Saved comparison tables: `docs/rounds/`.

## Measured results (Gemma 4 E4B on Ollama, this PC)

VerilogEval, same model, thinking off:

| Set | Raw model (one request) | Harness | Note |
|---|---|---|---|
| Held-out, 117 problems | 49 (42%), median 3.7 s | **64 (55%)**, median 18.3 s | Unbiased: nothing was tuned on these |
| Dev, 39 problems | 15 (38%), median 4.4 s | 27 (69%), median 18.9 s | Tuned on, so an upper estimate |

Held-out detail: 22 problems pass only with the harness, 7 only raw. Raw has 29 compile errors, the harness 2. The harness has 10 time-outs at 120 s, raw none. One run each; repeated dev runs varied by two or three problems.

Our own tasks, `fpga-fast` workflow: tuning set (gain, counter, fir4) 6 of 6; held-out set of six, measured once on an earlier commit, 9 of 12 (easy 4 of 4, medium 5 of 8).

Old harness easy task with the hidden judge: **0 of 30** with E4B. The data path is right in some runs and the register read-back in others, never both. The harness faults this task exposed are fixed. The real target, Gemma 4 26B on the office server, has **not been run** with this harness.

## What the harness does now (the parts that produced the gains)

- Plain-text tool calls, small prompt, context kept to a few thousand tokens.
- Skills loaded on demand: fixed-point, bus-registers, reset-and-state; a short always-on rules skill.
- Hints under failures: late output, x values, undriven output, unsigned limit, declarations inside a block, minus sign inside a sized constant (also repaired on save), include, unsized constant in a concatenation.
- Interface check: the design's ports against the spec's header or bullet list.
- No testbench unless the task asks for one; when it does, `tb_skeleton` generates it and `tb_checks` fills in the checks.
- A run cannot end on a design that was never compiled.
- Register read-back check built from the spec's register map (one bus convention, the old harness's).
- Quality gate (`npm run quality`), separate from pass or fail.
- Workflows with real retries, per-step time limits and thinking settings; protected files.
- `ask_user` tool: built, not yet given to the FPGA agent.

## How the work is done

- Codex runs whole improvement rounds from `briefs/round.md` and writes `docs/rounds/<date>-<n>.md`. Start it with `< /dev/null` or it waits on input. It has its own usage limit.
- Owner's rule: "Always guide and verify codex work." Nothing from Codex is committed before the type check, the tests and `scripts/check_evals.sh` are rerun, the change is tried on a real case, and its numbers are re-measured.
- Scoring runs use a frozen copy of a commit (a git worktree), so edits cannot disturb a run. The local model is shared: one scoring run at a time.
- Tune only on: VerilogEval dev, our three tuning tasks, the old harness's easy task. Held-out sets are measured, never read for tuning.
- Tests need Icarus on PATH (`C:\iverilog\bin`); 546 pass.

## Next steps, in order

1. **Owner: run on the server with the 26B model.** `docs/server.md` and `docs/verilog-eval.md` have the commands. First the raw and harness VerilogEval runs on dev, then the old harness's easy and medium tasks. This answers the main open question: how much of today's limit is the small model.
2. **Harness time-outs on held-out (10 of 117).** Seven problems passed raw and failed with the harness. Find out on the dev set what the agent does after a correct first write; do not read the held-out traces.
3. **Codex round 2** from `briefs/round.md`. Baseline: dev 27 of 39, median 19 s (commit c7778f9). Largest remaining groups on dev: state machines and reset timing, Karnaugh maps and vector order.
4. **Decide the default for spec-only tasks:** single agent with thinking off is the measured best (thinking on gave no gain and was 60% slower).
5. **Comparisons not yet run:** comment policies (`style-no-comments`, `style-header-comment`), `plan-first`, the descriptive topic skills. All can be preloaded with `-k`.
6. **Give the FPGA agent `ask_user`** and one prompt line; check on the Work screen that the question card works. Not yet looked at in the browser.
7. **Old harness medium task** has never been run.
8. **Low priority:** MCP card on the Agents screen not checked in the browser; desktop look of the screens not reviewed by the owner.

## Decisions waiting for the owner

- Push `ui-work-workflows` to GitHub?
- The "no testbench unless asked" rule is enforced by the harness for every agent. Keep it always on, or make it a setting per agent or workflow?
- A co-simulation tool that checks a streaming block against the task's bit-true Python model, so the model need not write a testbench. Not started.
- Show the raw test in the app's Workflows list? It needs a new "plain model request" step type. Saving the harness test as a workflow is small and needs no decision.
- Negative sized constants are repaired on save, with a note to the model. Keep, or hint only?

## Commands

```bash
npm test
```

```bash
npm run app -- --folder <project folder>
```

```bash
bash scripts/verilog_eval_raw.sh dev -s local-fast
```

```bash
bash scripts/verilog_eval.sh dev -s local-fast -t 120
```

```bash
node scripts/verilog_eval_report.mjs --compare <harness folder> <raw folder>
```

```bash
bash scripts/eval_set.sh tuning -n 2 -s local -w workflows/fpga-fast.json -t 150
```

```bash
bash scripts/h_task.sh /path/to/ai_demo easy office "<model id>" -n 3 -t 300
```
