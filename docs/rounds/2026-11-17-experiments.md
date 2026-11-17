# Round 2026-11-17: six workflow ideas, measured

Model: Gemma 4 E4B, `local-fast` (thinking off), Ollama on this PC.
Dev set: VerilogEval dev, 39 problems, 3 runs per variant. Baseline harness mean ≈24/39; a gain under 3 problems is noise.
Old easy task: baseline 0 of 30 runs.

Each idea was built in its own git worktree (`Harness-exp/{A,C,D,F}`, branches `exp/*`, not merged).

| Variant | Runs | Mean | Median s/problem | Result |
|---|---|---|---|---|
| A: review gate (reviewer compares design with spec, gate sends differences back) | 27, 22, 23 | 24.0 | ~38 | no gain |
| A+B: review gate + thinking (medium) on retry | 23, 22, 23 | 22.7 | ~39 | no gain, slower |
| C: harness picks skills from the spec text | 22, 28, 25 | 25.0 | ~17 | +1 (noise), but about half the time |
| D: golden-model differential sim (reference model first, random-stimulus compare) | 26, 27, 24 | 25.7 | ~37 | +1.7 (below bar) |
| E: plan-first skill preloaded | 24, 22, 21 | 22.3 | ~20 | no gain |
| F: old easy task split into data path / registers / testbench steps | 0 of 5 | — | 540–890 s/run | no gain |

## Notes

- D cut wrong answers (MISMATCH 3–7 per run against 11–14 for the others) but timeouts rose to 5–9 per run. The timeouts are almost all the hard FSM/sequential problems (fsmseq, q2afsm, lemmings3, fancytimer, conwaylife, countbcd), which the baseline mostly fails too. A longer time limit is the only obvious lever; not tried.
- F's smoke run exposed a real bug: the model copied the context-trimming placeholder "(file text omitted; the current file is on disk)" as a file's whole content. `write_file` now refuses it. This fix is merged into the main branch.
- Nothing else is merged. Experiment branches and worktrees are kept for inspection.

## Kept

- `src/tools/write_file.ts`: placeholder guard, test in `test/tools.test.ts`.
