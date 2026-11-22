# Experiment Y: cross-check the agent's design against two quick drafts

Read `briefs/autoresearch.md`. Work in this worktree on its branch (it starts from experiment W, which has `scripts/vote.mjs` with simulation grouping and the disagreement table of `--arbitrate`). Never call the model server and never run VerilogEval: the GPU is busy. The orchestrator smoke-tests and scores.

## Why (measured)

V (5 raw drafts, majority) scored 23 against the harness's 28 of 39: drafts were requested two at a time on a server that answers one at a time, so 2 of 5 timed out, and voting cost about 100 s before the agent could start. The harness agent alone is better than raw drafts. Keep the agent as the author; use drafts only as a cheap second opinion.

## Build

1. `vote.mjs --check <design file>` mode (keep the existing modes working):
   - Request N drafts (default 2) **one at a time** (concurrency 1). Per-request limit: `max_tokens` 3000 in the request body and a 90 s timeout.
   - Compile drafts; drop those that fail. Group the design and the compiling drafts by simulation as voting does.
   - If at least two drafts compile, agree with each other, and the design disagrees with them: print the disagreement table (as arbitration builds it: up to 6 rows, clocked designs with the 3 cycles before each row; columns "your design" and "other drafts"), then a line `CROSSCHECK: 2 independent drafts agree with each other and differ from rtl/TopModule.sv on the rows above. Check these rows against the spec. If your design is right, keep it unchanged.` and exit 1.
   - In every other case (design agrees with a draft, drafts disagree with each other, fewer than two compile, any request or simulation error): print `CROSSCHECK: no evidence against the design` and exit 0. The design file is never modified by this script.
2. `workflows/fpga-crosscheck.json`:
   - step `write`: agent `fpga`, task `{task}`, maxSeconds 200, thinking off.
   - step `check`: command `node {root}/scripts/vote.mjs --check {design} --spec spec.md --server {server} --model {model} -n 2 --temperature 0.8`, timeoutSec 120, `onFail: { goTo: "write", maxRounds: 1 }`.
   Check that the workflow engine passes the failing command's output (the table) to the agent on the retry; if it trims the output (it keeps lines with FAIL/ERROR/MISMATCH, up to 10), make sure the table survives: e.g. print every table line with a `MISMATCH ` prefix, or adapt `runCommand` to keep the whole output of a step marked `"feedback": "all"`. Choose the smaller change and test it.
3. Tests (vitest, model mocked with a local HTTP server): drafts agree and design differs leads to exit 1 with table; design agrees with one draft leads to exit 0; drafts disagree leads to exit 0; requests are sequential (the mock sees at most one open request); design file unchanged; the workflow retry receives the table.

## Done when

`npx.cmd tsc --noEmit`, `npx.cmd vitest run --maxWorkers=2`, `bash scripts/check_evals.sh` pass (Icarus at `C:/iverilog/bin`). Write `docs/rounds/2026-11-23-Y.md` (short). Leave changes uncommitted if git refuses; the orchestrator commits.
