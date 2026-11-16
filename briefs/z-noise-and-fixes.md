# Task Z: measure the noise, three small harness fixes, then a spec self-check

You work alone and unattended; nobody can answer questions. Read `briefs/common.md`, `briefs/round.md` (all its hard rules apply here) and `HANDOFF.md` first. When a choice is not settled by this brief, take the smaller, more conservative option and list it under "Choices I made" in the report.

Do the stages in order. Write the report file after every stage, so a stop in the middle loses nothing. Report: `docs/rounds/2026-11-16-1.md`.

Background: on VerilogEval the harness beats the raw model (dev 27 against 15 of 39) but some easy problems pass raw and fail with the harness. Causes seen: a design that compiles but is wrong gets no feedback; a skill that does not fit the problem is loaded; a run ends although the final compile check failed; the "two drivers" hint is repeated and triggers rewrites. Tune on the dev split only. Never read held-out traces.

Commands (Icarus at `C:/iverilog/bin` on PATH; one scoring run at a time):
- harness: `bash scripts/verilog_eval.sh dev -s local-fast -t 120`
- raw: `bash scripts/verilog_eval_raw.sh dev -s local-fast`
- compare: `node scripts/verilog_eval_report.mjs --compare <harness folder> <raw folder>`

## Stage 1: noise (no code changes)

Run the harness command three times and the raw command three times. Report for each: passed of 39 per run, the minimum, maximum and mean, median seconds, and the list of problems whose result differs between runs of the same kind. State the spread in one sentence: a later change smaller than this spread is not evidence.

## Stage 2: three small fixes

1. Skill choice. Rewrite only the `description` line of `agents/fpga/skills/fixed-point.md`, `bus-registers.md` and `reset-and-state.md` so each says when to load it and when not to (for example: not for plain gates, counters or flip-flop banks without a bus). Do not change which skills are offered. Find on dev how often a skill is loaded for a problem it does not fit, before and after.
2. Final compile check. Today the run may end after the check has failed twice. Add one more round whose message contains the exact compiler error line and file line, and nothing else new. Do not restore or rewrite files in code.
3. Driver-conflict hint: show it at most once per file per run.

Add tests for 2 and 3. Run `npx.cmd tsc --noEmit` (root and `web/`), `npx.cmd vitest run`, `bash scripts/check_evals.sh`. Then run the harness command twice and compare with the Stage 1 harness mean and spread. Then the regression check: `bash scripts/eval_set.sh tuning -n 2 -s local -w workflows/fpga-fast.json -t 150`.

If the mean drops by more than the Stage 1 spread, find which fix caused it, revert that fix, measure again, and say so at the top of the report.

## Stage 3: spec self-check (only if Stage 2 is finished and not worse)

Goal: a deterministic behaviour check for spec-only tasks, costing no model time.

- When the spec text contains a complete truth table (a Markdown or plain-text table of input columns and output columns with 0/1 values), build a small Verilog test from it in code, run the design with Icarus after a successful compile, and compare.
- A mismatch is reported to the model as a `Hint:` line under the compile result, naming the first three failing rows (inputs, got, wanted). It never blocks the run and never fails the compile. Reason: blocking checks caused a regression in round 1.
- If the table cannot be parsed with certainty (missing columns, don't-care symbols, names not matching the ports), do nothing and say nothing.
- Truth tables only. Do not attempt waveforms or state tables; describe in the report what they would need.
- New code in its own file under `src/tools/`, with tests, including a test that the nine reference designs get no hint.

Measure: harness command twice; report how many dev problems have a parsable table, how many times the hint fired, and whether the model fixed the design after it.

## Final verification (always, even if a stage was skipped)

- Type check, tests and `check_evals.sh` pass; give the counts.
- One raw run and the last harness run compared with `--compare`; paste the summary table.
- Report sections: numbers per stage; what got better; what got worse, named plainly; fixes kept and fixes reverted; files changed; characters added to prompt or skills; "Choices I made"; anything you are unsure about.
- Add at the top of `HANDOFF.md`, under the title, a section "Task Z result (written by Codex, not yet verified by the owner or Claude)" of at most eight lines with the numbers and the report path. Edit nothing else in that file.

Do not use git. Do not edit `PLAN.md`. Print the report text as your final message.
