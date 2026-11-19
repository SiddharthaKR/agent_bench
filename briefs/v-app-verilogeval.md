# Task V: wire VerilogEval into the Workflows screen, live

You work alone and unattended. Read `briefs/common.md` and `HANDOFF.md` first. When this brief leaves a choice open, take the smaller, more conservative option and list it under "Choices I made" in the report `docs/rounds/2026-11-19-V.md`. Do not run git. Do not edit HANDOFF.md or PLAN files. Do not change the scoring scripts' behaviour (`scripts/verilog_eval*.sh`, `scripts/verilog_eval_report.mjs`, `scripts/verilog_eval_raw.mjs`); you may export existing functions from them or move shared code into a module both use, as long as their output stays byte-identical. Never read held-out traces.

Goal (approved by the owner): in the browser app, the owner wires steps in the Workflows screen, picks VerilogEval problems, presses Run, and watches each problem live, with a verdict per problem and a running total. The judge is optional; nothing in this changes how the normal Work/Workflows runs behave.

## 1. Two new step types (src/shared/api.ts, src/workflow.ts, web step editor)

- `{ type: "judge", id, name, file?: string }` — "VerilogEval judge". Judges the design file (default `{design}`, i.e. `rtl/TopModule.sv`) against the current problem's hidden test and reference, with exactly the same judge function, flags and verdict names as `scripts/verilog_eval_report.mjs` (`judge`, `parseVerdict`: PASS, MISMATCH, COMPILE_ERROR, NO_FILE, TIME, JUDGE_ERROR). It shows the verdict as the step text. It NEVER feeds back: reject `onFail` on a judge step when a workflow is loaded or saved (clear error message), and a failing verdict does not fail the run or loop back; the step ends `passed` when PASS, otherwise `failed`, and the workflow continues to the next step. The hidden test files must never be copied into the problem folder or shown to any agent; judge in a separate folder (as the scoring script does).
- `{ type: "raw", id, name, file?: string, model?, maxSeconds? }` — "Raw model". One streamed chat request with exactly the raw benchmark prompt from `scripts/verilog_eval_raw.mjs` (system and user message, extraction rules, no repair), using the run's server. Writes the extracted code to `file` (default `{design}`); writes nothing when no code was extracted. Shows the reply's first lines as step text. No tools, no retries.
- Both step types only make sense on a VerilogEval problem run (below); outside one they end `failed` with the text "Only in a VerilogEval run."

## 2. VerilogEval runs (server)

- New API: `GET /api/verilog-eval/problems` → `{ dev: string[], heldout: string[] }` from the existing split (`ensureSplits`). `POST /api/verilog-eval/runs` with `{ workflowId, server, problems: string[], repeats?: number }` → `{ id }`. `GET .../runs/:id/events` streams live (same SSE helper as `/api/runs`), `POST .../runs/:id/stop`. Allowed only when the benchmark is present under `external/verilog-eval`; otherwise a clear 400.
- A run goes problem by problem, one at a time. For each problem: a fresh folder `runs/verilog-eval-app/<timestamp>/<problem>/` containing only `spec.md` (same text the scoring script gives the agent), vars `design=rtl/TopModule.sv`, `tb=tb/tb_top.sv`, task text identical to the scoring script's harness task. Run the workflow there with the existing workflow engine (agent steps trace as usual into that folder). A step-level verdict from every judge step is recorded.
- Events carry: the problem list with per-problem status (waiting / running / its verdict(s), one per judge step, labelled by step name), the running totals per judge step ("PASS k of n done"), and for the running problem the normal workflow events, so the existing live step view can show it.
- At the end write `summary.json` in the run folder (per problem: verdicts per judge step and seconds) and append one line per judge step to `runs/results.jsonl` in the same shape the scoring script uses, with a field `source: "app"` and the workflow id.

## 3. Web

- Workflows screen: the step editor offers "VerilogEval judge" and "Raw model" alongside agent and command, with their few fields. The graph shows them; a judge step shows no onFail control.
- Run panel: next to the normal Run, a "Run on VerilogEval" control: choose dev, held-out, all, or tick problems from a searchable list; repeats (default 1); server as today. While running: a list of problems with live status and verdict chips (one column per judge step), totals at the top, a Stop button, and clicking a problem shows its live step view (reuse the existing run view components). Finished runs remain viewable from the Trace screen (make the trace list also find traces in `runs/verilog-eval-app/*/*/`).
- Keep the current look; follow existing CSS and components.

## 4. Two ready-made workflows

- `workflows/verilog-raw.json`: raw step, then judge.
- `workflows/verilog-compare.json`: raw step writing `rtl/raw/TopModule.sv`, judge it ("Raw"); then the fpga agent writing `{design}` with the same task/settings as the scoring script's plain harness run (tools, time 120 s), then judge it ("Harness"). The two parts must not see each other's file: protect / hide `rtl/raw/` from the agent (use existing protect and edit policy; if the agent could still read it, move the raw file outside the agent's workspace instead and say how in the report).

## 5. Tests and checks

- Unit tests: judge step verdicts (use the fixtures/approach of existing judge tests; a known-good reference passes, a broken file mismatches, missing file is NO_FILE), judge rejects onFail, raw step extraction/write (mock the model), problem-run folder contains only spec.md, results.jsonl line shape, web logic for the new step types.
- Run `npx.cmd tsc --noEmit` (root and `web/`), `npx.cmd vitest run`, `bash scripts/check_evals.sh`, and `npm run web:build`. All must pass.
- Do not run model scoring; the reviewer will. Write in the report exactly how to start the app and the run, and what you could not verify.
