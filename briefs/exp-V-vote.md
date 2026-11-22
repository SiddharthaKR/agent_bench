# Experiment V: sample several designs, keep the one most of them agree with

Read `briefs/autoresearch.md` first. You work in the worktree you were started in, on its branch. Never call the model server and never run VerilogEval: the GPU is busy with scoring runs. The orchestrator smoke-tests and scores.

## Why

Wrong logic that compiles is the largest failure group. One sample from a small model is often wrong, but wrong samples rarely agree with each other, while correct ones agree exactly. Self-consistency by simulation: generate N designs, simulate them against each other on the same random inputs, and keep a design from the largest group that behaves identically.

## Build

1. Port `scripts/diff_sim.mjs`, its tests and fixtures from `../Harness-exp/D` (branch `exp/D`, uncommitted files there). Also port the built-in `{root}` workflow variable from that worktree's `src/index.ts` and `src/engine.ts` diff. Do not port the reference agent or `onFail.note` unless you need them.
2. `scripts/vote.mjs`, called by a workflow command step:
   `node {root}/scripts/vote.mjs --spec spec.md --out rtl/TopModule.sv --server <id> [--model <id>] -n 5 --temperature 0.8`
   - Read the server settings with the same merge as `src/config.ts` (config.json, then config.local.json) from `{root}`.
   - Make N independent chat requests (OpenAI-compatible `/chat/completions`, non-streaming, the server's `extra` fields merged in, e.g. `reasoning_effort`). Run them concurrently 2 at a time at most. System message: the body of `agents/fpga/skills/verilog-rules.md` (without front matter). User message: the spec text, then "Write the complete module. Reply with one ```verilog code block only."
   - Extract the first fenced block (or `module ... endmodule`). Save every candidate as `.build/vote/cand<i>.sv`.
   - Compile each alone with the configured compile command. Drop those that fail.
   - Compare every pair of compiling candidates with diff_sim logic (same port check, fixed seed, reset for clocked designs, 200+ samples). Agreement = zero mismatches. Build groups (a candidate joins a group when it agrees with the group's first member).
   - Write the first member of the largest group to `--out` (ties: the group whose first member came first). Print one line per candidate (`cand2: compiles, group 1`) and a final line `VOTE: group of K of N, wrote rtl/TopModule.sv`.
   - When no candidate compiles: exit 1 with the compile error of the first candidate, so the workflow's onFail sends it to the agent.
   - Total wall time under 150 s for N=5 on a 20 token/s model: put a timeout on every request.
3. `workflows/fpga-vote.json`:
   - step `vote`: command step running vote.mjs, `onFail: { goTo: "fix", maxRounds: 2 }`... but a command step cannot go forward. Design it so the order works: step 1 `vote` (command, never fails the run: when nothing compiles, still write the first candidate so the agent has a file to fix, and exit 0); step 2 `fix`: agent `fpga`, task "rtl/TopModule.sv was chosen by comparing several drafts. Compile it. If it compiles and matches the spec, finish without changes. Fix only compile errors or a clear contradiction with the spec." maxSeconds 120, thinking off.
   - Also a variant `workflows/fpga-vote-only.json` with only the vote step (no agent), so the orchestrator can measure the agent's value separately.
4. Tests (vitest): candidate extraction; grouping picks the majority (use fixtures: three equivalent adders written differently plus one wrong); tie rule; no compiling candidate writes the first candidate and exits 0; server config merge. Mock the HTTP model (a local `http.createServer` returning canned replies).

## Done when

- `npx tsc --noEmit`, `npx vitest run`, `bash scripts/check_evals.sh` pass (Icarus at `C:/iverilog/bin`, put it on PATH).
- Commit on your branch with a clear message. Write `docs/rounds/2026-11-22-V.md`: what was built, test results, the smoke lines, choices you made. Keep it short.
