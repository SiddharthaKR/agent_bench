# Task Z3: truth-table self-check

You work alone and unattended; nobody can answer questions. Read `briefs/common.md`, the hard rules in `briefs/round.md`, and `docs/rounds/2026-11-16-1.md` (task Z, stages 1 and 2) first. When a choice is not settled here, take the smaller, more conservative option and list it under "Choices I made". Write the report after every stage to `docs/rounds/2026-11-16-2.md`.

Starting point: commit b121f77. Dev baseline with this code: harness 24 and 25 of 39; noise across five runs 22 to 25 (mean about 24). A change under 3 problems is not evidence.

## Build

Goal: a deterministic behaviour check for spec-only tasks, costing no model time. Wrong logic that compiles is the largest failure group left.

- When the spec text contains a complete truth table (Markdown or plain-text table, input columns and output columns, 0/1 values), build a small Verilog test from it in code, run the design with Icarus after a successful compile, and compare.
- Combinational designs only: skip the check if the module has a clock-like port (`clk`, `clock`) or the table has a time or cycle column.
- A mismatch is reported as a `Hint:` line under the compile result, naming at most three failing rows (inputs, got, wanted). It never blocks the run and never fails the compile (blocking checks caused a regression in round 1).
- Show the hint again only when the failing rows change.
- If the table cannot be parsed with certainty (missing columns, don't-care symbols such as `x`, `-` or `d`, names not matching the ports, widths not matching), do nothing and say nothing.
- Truth tables only; no waveforms, no state tables.
- New code in its own file under `src/tools/`, called from the compile tool. Tests: parsing (good tables, rejected tables), a right design gets no hint, a wrong one gets the rows, the nine reference designs get no hint.

Run `npx.cmd tsc --noEmit` (root and `web/`), `npx.cmd vitest run`, `bash scripts/check_evals.sh`.

## Measure

Icarus at `C:/iverilog/bin` on PATH. One scoring run at a time.

1. `bash scripts/verilog_eval.sh dev -s local-fast -t 120`, three times.
2. Tuning regression: `bash scripts/eval_set.sh tuning -n 2 -s local -w workflows/fpga-fast.json -t 150`. It failed at start on this PC last time (tsx, `os.userInfo` ENOMEM). Try it once as written; if it fails the same way, use the same workaround as task Z and say so. Do not edit the script.

Report:
- how many dev specs have a table the check accepts, and their problem names;
- how many times the hint fired, and in how many of those the model then fixed the design;
- passed of 39 per run, mean, median seconds, verdict counts, against the baseline;
- the tuning result;
- false hints: any hint on a design the judge passed. Each one is a bug; describe it.

If the dev mean drops by 3 or more, disable the check (keep the code and tests, add an off switch defaulting to off) and say so at the top.

## Finish

- Type check, tests, `check_evals.sh` pass; give counts.
- At the top of `HANDOFF.md`, under the title, add a section "Task Z3 result (written by Codex, not yet verified)" of at most six lines. Edit nothing else there.
- Do not use git. Do not edit `PLAN.md`. Print the report as your final message.
