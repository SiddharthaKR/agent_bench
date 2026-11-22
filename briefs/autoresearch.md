# autoresearch for the harness

The method of `autoresearch/program.md` (Karpathy), applied to this harness. One metric, a fixed judge, one change per experiment, keep or discard, a log of everything tried.

## Fixed (never edit during an experiment)

- The benchmark: `external/verilog-eval` (commit c498220), the dev/held-out split in `evals-external/verilog-eval/`.
- The judge and runner: `scripts/verilog_eval_report.mjs`, `scripts/verilog_eval_raw.mjs`. They are this project's `prepare.py`.
- The model and server settings for a series: `-s local12` (Gemma 4 12B Q4_K_M, Ollama, 16k context, thinking off unless the experiment is about thinking).
- The time budget per problem: `-t 300` (wall clock, whole workflow, including command steps). This is the "5 minutes" of autoresearch: every experiment gets the same budget, so speed is part of the score.

## What may change

Everything in the harness: `agents/` (prompts, skills), `workflows/`, `src/` (tools, hints, engine), new scripts that a workflow calls. Not the judge, not the benchmark, not the split.

## Metric

`dev pass count` of 39 VerilogEval dev problems, one run. Secondary: median seconds per problem, then simplicity.
Measured noise on E4B: the same code scored 22 to 25. A change is **kept** only when it gains at least 3 problems, or is equal and simpler or faster. Gains of 1 or 2 are rerun once before keeping.
Held-out (117) is measured only at the end of a series, never read for tuning.

## Loop

1. Commit the experiment on branch `autoresearch/<tag>`.
2. Score it from the frozen worktree `../Harness-ar` (`git -C ../Harness-ar checkout --detach <commit>`), so edits cannot disturb a run. One scoring run at a time: the GPU is shared.
   `bash scripts/verilog_eval.sh dev -s local12 -t 300 [-w workflows/<file>.json] > run.log 2>&1`
3. Read `Passed N of 39`, the verdict counts and the median from the log.
4. Append a row to `results.tsv` (untracked, tab-separated): `commit	pass	median_s	status	description`. Status is `keep`, `discard` or `crash`.
5. Keep: the branch advances. Discard: `git reset --hard` to the last kept commit (the row stays in the log).
6. Before the next idea, read the failing traces of the latest run (dev only), group the failures, and pick the change aimed at the largest group.

## Rules carried over from this project

- Correct RTL first, then speed. The testbench matters only when the task asks for one.
- A Codex change is not kept until the type check, the tests and `scripts/check_evals.sh` pass and the number is re-measured here.
- Simpler is better: a +1 that adds a hundred lines is a discard; equal score with less code is a keep.

## Experiment queue (2026-11-22, owner asked for every category to be tried; keep only what scores)

Order by expected gain; reorder after each failure analysis. Each is one A/B against the current best.

1. V: several drafts, majority by simulation (`exp/V`); then V without the repair agent.
2. Thinking: off / on / on only for the retry.
3. Skills per failure group: Karnaugh map and truth table, FSM from a table, vector and bit order, cellular automata (rule90/110, conwaylife). Preloaded against chosen by the model.
4. Tools: truth table to logic, state table to case statement, simulate with a printed trace of the design's outputs.
5. Subagent: reviewer compares design with spec (retest of E4B's A on 12B).
6. Spec-driven: spec to checklist (ports, behaviours, edge cases), RTL against it, checklist check at the end.
7. Self-grill: the agent lists the spec's ambiguities, picks the literal reading, states assumptions, then writes.
8. One-shot: one worked example per problem kind.
9. Compaction or plan mode: only if traces show context overflow or lost track.
10. Combinations of near-misses.

Scoring: `bash scripts/ar_run.sh <label> <commit> -s local12 -t 300 [-w workflows/x.json]` (chunks of 8, model unloaded between chunks, waits for 3 GB free RAM).
