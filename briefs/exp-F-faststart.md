# Experiment F: fast start (fewer model replies before the first write)

Read `briefs/autoresearch.md` and `docs/rounds/ideas.md`. Work in this worktree on its branch (the last kept state). Never call the model server and never run VerilogEval; the orchestrator scores.

## Why (measured on 75 passing baseline runs, Gemma 4 12B)

Mean 62.9 s per problem; the model takes 62.5 s of it in 6.3 replies (9.9 s each); tools take 0.4 s. The first reply alone is 16.3 s. Typical opening: read spec.md, sometimes use_skill, then write. Every reply removed saves about 10 s.

## Build (one experiment, three parts that all remove opening replies; all on by default behind one option `fastStart`, off with `--fast-start off`)

1. **Spec in the first message.** When the task names `spec.md` (or another existing `.md` file in the project) and the file is at most 8000 characters, the harness appends its text to the first user message, as if read_file had returned it ("spec.md, lines 1-N of N" with numbered lines, the same format read_file uses), and records it in `ctx.specTexts` exactly as a read would, so the interface check and other spec-aware hints keep working.
2. **Skills chosen by the harness.** Port the deterministic skill selector from experiment C: `../Harness-exp/C/src/skill_select.ts` and its tests (uncommitted files in that worktree), plus the minimal wiring so chosen skills are preloaded through the existing skill preload path. Do not port C's prompt change unless needed. Explicit `--skills` still wins. use_skill stays available.
3. **Header pre-fill.** When the spec gives the module's ports (a module header or the bullet list the interface check already parses, `src/tools/interface.ts`) and the target file named in the task (e.g. `rtl/TopModule.sv`) does not exist, write it before the first request: the exact module header with every port (directions, widths, `reg` only if needed is not knowable, so declare outputs as plain `output` with width; the model may change to `output reg`), a line `// write the body here`, and `endmodule`. Tell the model in the first message: "rtl/TopModule.sv already has the exact ports from the spec; write the whole file with write_file, keeping the ports." The run-end rule "a run cannot end on a design that was never compiled" must still apply: the pre-filled file counts as never compiled.

## Tests

Spec appended once and recorded as read; long spec not appended; skill selection for a counter spec and none for a gate spec; header pre-fill for a bullet-list spec and for a spec with a module header, with widths; no pre-fill when the file exists or no ports are found; `--fast-start off` restores the old behaviour exactly (same first request text).

## Done when

`npx.cmd tsc --noEmit`, `npx.cmd vitest run --maxWorkers=2`, `bash scripts/check_evals.sh` pass (Icarus at `C:/iverilog/bin`). Write `docs/rounds/2026-11-23-F.md` (short; include the first request of one VerilogEval dev spec, e.g. Prob060_m2014_q4k, as it would now be sent, built without a model call). Leave changes uncommitted if git refuses.
