# Experiment W: when the drafts disagree, ask the model which outputs match the spec

Read `briefs/autoresearch.md` and `docs/research/2026-11-22-rtl-agents.md` (VRank's optional step). Work in this worktree on its branch, which starts from experiment V (`scripts/vote.mjs`, `scripts/diff_sim.mjs`). Never call the model server and never run VerilogEval: the GPU is busy with scoring. The orchestrator smoke-tests and scores.

## Why

Voting fails when the largest group is not a clear majority (for example 2 of 5 against 2 of 5, or 2 against 1+1+1), or when the majority shares the same misreading. VRank adds one step: show the model the inputs where the groups disagree and each group's outputs, and let it judge against the spec. Judging a concrete row is easier for a small model than writing correct logic.

## Build

1. In `vote.mjs`, add `--arbitrate` (off by default). When it is on and there are at least two groups:
   - Take the representative (first member) of each group, at most 4 groups, largest first.
   - Find input samples where the representatives' outputs differ: reuse the diff_sim stimulus (same seed, same reset handling), simulate all representatives on the same stimulus in one testbench, and print, per sample, the inputs and each representative's outputs. For clocked designs print the cycle number too, and keep the earlier cycles of the same run, because a state machine's output depends on history: report up to 6 disagreeing samples, each with the 3 cycles before it.
   - One model request: system message as in voting; user message: the spec, then a table with rows "cycle | inputs | output of A | output of B | ...", then: "For each row marked with *, say which of A, B, ... matches the specification. Answer one line per marked row: `row <n>: <letter>`. Use only the specification."
   - Parse the answers; each answer gives one point to that group. Ignore unparseable lines. Pick the group with the most points; on a tie or no parseable answer, keep the largest group (voting's choice).
   - Print `ARBITRATE: rows 6, points A=4 B=2, chose A` and save the request and the reply in `.build/vote/arbitrate.json`.
   - When the largest group already holds more than half of all compiling drafts, skip arbitration (print `ARBITRATE: skipped, majority`), unless `--arbitrate-always`.
2. `workflows/fpga-vote-arb.json`: as `fpga-vote.json` with `--arbitrate`.
3. Tests (vitest, model mocked with a local HTTP server): the disagreement table for a combinational pair and for a counter pair (fixtures from diff-sim); answer parsing; points decide; tie keeps the largest group; skipped on a clear majority.

## Done when

`npx.cmd tsc --noEmit`, `npx.cmd vitest run --maxWorkers=2`, `bash scripts/check_evals.sh` pass (Icarus at `C:/iverilog/bin`). Write `docs/rounds/2026-11-22-W.md` (short: what, tests, choices). Leave the changes uncommitted if git refuses; the orchestrator commits.
