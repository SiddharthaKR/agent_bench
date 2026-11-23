# Autoresearch series nov22: Gemma 4 12B on VerilogEval dev (2026-11-22 to 11-23)

Method: `briefs/autoresearch.md` (Karpathy's autoresearch applied to the harness). Ideas and their status: `docs/rounds/ideas.md`. Branch `autoresearch/nov22`; experiments on `exp/*` branches with worktrees in `../Harness-exp/`. Scoring from the frozen worktree `../Harness-ar` with `scripts/ar_run.sh`.

Model: `gemma4-12b-ctx16k` (Gemma 4 12B Q4_K_M, Ollama, 16k context, made from `gemma4:12b` with `num_ctx 16384`), thinking off, temperature 0.2, ~20 tokens/s on the RTX 5060 laptop (8 GB; part of the model in system RAM). 300 s per problem.

## Results (dev, 39 problems, one run each unless noted)

| Run | Commit | Pass | Median s | Status | Notes |
|---|---|---|---|---|---|
| Raw 12B, one request | — | 21 | 18 | reference | 4 compile errors, 4 runaway time-outs |
| **Harness baseline** | 2ed2ed0 | **28** | 57 | keep | 0 compile errors |
| Harness baseline, repeat | 2ed2ed0 | **29** | 78 | keep | mean 28.5 |
| V: 5 raw drafts, majority by simulation | 445bb4a (exp/V) | 23 | 143 | discard | one-slot server: drafts queued and timed out |
| W: V + model judges disagreements | 06bfe45 (exp/W) | 22 | 141 | discard | |
| Cold testbench (Codex, spec only) | db10ab0 | 27 | 73 | discard for now | wrong logic 7 to 1, time-outs 4 to 11 |
| X: reply cap 3000 tokens | 5419dfd | 25 | 69 | discard, reverted | runaway time-outs gone, but those problems finished wrong |
| X + cold testbench | 5419dfd | 27 | 70 | discard | |
| Y: agent + 2 sequential drafts cross-check | aa72eb9 (exp/Y) | 24 | 147 | discard | drafts cost ~90 s per problem |

Quality with the full gate (Verilator + Yosys from WSL), baseline designs: 33 of 35 clean; 26 of 39 correct and clean.

No idea beat the baseline. Best remains the harness as it was at the start of the series (28 and 29 of 39).

## What was learned

1. **Noise is large.** Two baseline runs: 26 pass both, 8 fail both, 5 flip (q4k, vector3, gatesv100, fsmseq, q2afsm). A difference of 3 or less from one run is not evidence. Rerun near-misses.
2. **All time is model time.** Passing runs: 62.9 s, of which 62.5 s is 6.3 model replies (9.9 s each); tools 0.4 s; first reply 16.3 s (model reload plus prompt). Speed means fewer replies, not faster tools.
3. **More drafts do not pay on this PC.** Ollama answers one request at a time, so every extra draft costs a full reply. V, W and Y all lost on time.
4. **Runaway replies cause random time-outs.** The harness sends no `max_tokens`; 12B sometimes reasons inside one reply for minutes (time-outs with 0 to 2 tool calls in every run). A 3000-token cap still allowed 190 s replies.
5. **Codex testbenches are good; 12B cannot use them yet.** 37 of 39 cold testbenches accept the reference (rule110 rejects it, xnorgate does not compile in Icarus). They find the bugs (wrong logic 7 to 1), but single-instant FAIL lines do not show the model why; it rewrites blindly until time runs out.
6. **Literature** (`docs/research/2026-11-22-rtl-agents.md`): VRank (+7 to +16 for open models by simulation voting), MAGE (role separation +21 on Claude; debug window), VerilogCoder (waveform tracing +11.5, but its published result runs the benchmark's own testbench).

## Built and checked, not yet scored

- **Z: waveform table** (`exp/Z2`, aaa9730, on the kept base). On a failed run_sim, a table of the design's ports at each clock edge before the first failure, plus the failure row. Checked on the real q4k bug with its Codex testbench. Score with: `bash scripts/ar_run.sh Z2-wave-coldtb aaa9730 -s local12 -t 300 -b evals-external/cold-tb`
- **F: fast start** (`exp/F2`, 56e2253, on the kept base). Spec in the first message, harness-chosen skills (from experiment C), module header pre-filled. Score with: `bash scripts/ar_run.sh F-faststart 56e2253 -s local12 -t 300`

## Infrastructure added

- `scripts/ar_run.sh`: one problem per chunk, model unloaded after each problem (the model server grows from ~11 to ~19 GB within long runs), waits for 3 GB free RAM, writes `runs/ar-<label>.log` with a TOTAL line.
- `scripts/cold_tb.sh` and `evals-external/cold-tb/` (39 dev testbenches by Codex from the spec alone; logs show no benchmark file access).
- Runner option `-b <dir>`: a given testbench in `tb/`, protected; the judge is unchanged.
- `scripts/wsl_tool.sh`: Verilator and Yosys from WSL (`~/tools/oss-cad-suite`) for the quality gate (`commands.lint`, `commands.synth` in `config.local.json`).
- Servers in `config.local.json` (not committed): `local12`, `local12-think`, `local12-t0` (temperature 0, seed 42).
- Claude Code must be started with `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` for long unattended runs.

## Plan for the next session, in order

1. **Z with the cold testbench.** Biggest expected gain: turns found bugs into fixes. Keep bar: 31 or more (mean baseline 28.5 + 3).
2. **F fast start.** Expected: about half the median time at equal accuracy; must not lower quality.
3. **Tighter reply cap, about 1500 tokens** (idea 17), on its own; then combined with Z.
4. **Temperature 0 with seed, two runs** (idea 15): repeatability, then use it for all later A/B runs if the score holds.
5. **Industry track baseline** (idea 14): `bash scripts/eval_set.sh heldout -n 1 -s local12 -w workflows/fpga-fast.json -t 300` and `bash scripts/h_task.sh C:/Users/siddh/Documents/Personal/DUMP/ai_demo easy local12 gemma4-12b-ctx16k -n 1 -t 900`, with the full quality gate.
6. **Lint in the loop and the coding-standard skill** (ideas 12, 13), judged on the industry track.
7. Then: table compiler (4 problems), spec example check (always_case2), Python oracle subagent for prose clocked specs.
