# autoresearch for the harness

The method of `autoresearch/program.md` (Karpathy), applied to this harness. One metric, a fixed judge, one change per experiment, keep or discard, a log of everything tried.

## Fixed (never edit during an experiment)

- The benchmark: `external/verilog-eval` (commit c498220), the dev/held-out split in `evals-external/verilog-eval/`.
- The judge and runner: `scripts/verilog_eval_report.mjs`, `scripts/verilog_eval_raw.mjs`. They are this project's `prepare.py`.
- The model and server settings for a series: `-s local12` (Gemma 4 12B Q4_K_M, Ollama, 16k context, thinking off unless the experiment is about thinking).
- The time budget per problem: `-t 300` (wall clock, whole workflow, including command steps). This is the "5 minutes" of autoresearch: every experiment gets the same budget, so speed is part of the score.

## What may change

Everything in the harness: `agents/` (prompts, skills), `workflows/`, `src/` (tools, hints, engine), new scripts that a workflow calls. Not the judge, not the benchmark, not the split.

## Metric (owner, 2026-11-23: accuracy and industry standard first, then speed)

Three numbers per run, in this order: (1) dev pass count; (2) designs that pass the quality gate (`npm run quality`: Icarus -Wall, Verilator lint and Yosys synthesis when installed, the harness's model-free checks); (3) median seconds. Keep an idea only if (1) rises, or (1) is equal and (2) or (3) improves, with none of the three worse beyond noise. A faster harness with worse accuracy or quality is a discard.
Kept ideas are also checked on the industry track: the project's held-out tasks (`bash scripts/eval_set.sh heldout`) and the old harness's easy and medium tasks, with the full quality gate.

## Dev pass count

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

## Experiment queue (2026-11-22; ordered by the evidence in `docs/research/2026-11-22-rtl-agents.md` and by our own failures; keep only what scores)

Each is one A/B against the current best. Reorder after each failure analysis.

1. V: several drafts, majority by simulation (VRank-like, `exp/V`); then without the repair agent; then more drafts.
2. V + arbitration: where the groups disagree, show the model the inputs and each group's outputs, and ask which matches the spec.
3. Role separation (MAGE): a separate checks subagent, fresh context, writes inputs and expected outputs from the spec (printed as a text waveform) only to help the RTL agent choose or fix its design. RTL is the deliverable and the priority: the RTL agent never writes a testbench, the checks are never scored, and a disagreement between the checks and the design is a hint, never a block.
   Safeguards, because the checks can be wrong: (a) the checks subagent cannot write `rtl/` (protected); (b) the run always ends with an RTL file; (c) drafts that agree with each other outvote the checks: a check only breaks a tie between disagreeing drafts or guides a design with no majority; (d) the design is saved before any check-driven fix, and restored if the fix does not compile or moves away from the agreeing drafts; (e) the checks subagent gets at most 60 s of the 300 s budget; (f) the report lists problems that passed in the previous best run and fail with the checks: a few such flips mean discard or tighten the rules.
3b. Big-model checks (owner's request; reported as "local RTL + cloud checks", separate from local-only rows):
   - Cold: Codex writes one testbench per problem from `spec.md` alone, in an empty folder, before the RTL run (`scripts/cold_tb.sh`). The RTL agent gets it as a given testbench; the same safeguards apply. Codex logs are checked for any access to the benchmark's reference or test files. Also report how often a cold testbench rejects the benchmark's reference design (measurement only, never used to filter or fix testbenches).
   - On demand: a tool the local agent calls when stuck (no majority, or the same failure twice); Codex writes checks for that case. Time reported separately.
   - Compared with: no testbench, local checks subagent (3).
4. Debug window on a mismatch: the cycles before the first mismatch as a table (MAGE, VerilogCoder tracing).
5. Thinking: off / on / on only for the retry.
6. Skills per failure group: Karnaugh map and truth table, FSM from a table, vector and bit order, cellular automata.
7. Signal-level plan (VerilogCoder-like task graph).
8. Subagent reviewer (retest of E4B's A on 12B).
9. Ideas without literature evidence, tried last: self-questioning of the spec, one-shot examples, compaction or plan mode (only if traces show the need).
10. Combinations of near-misses.

Scoring: `bash scripts/ar_run.sh <label> <commit> -s local12 -t 300 [-w workflows/x.json]` (chunks of 8, model unloaded between chunks, waits for 3 GB free RAM).
