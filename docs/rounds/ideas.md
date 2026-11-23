# Idea list (autoresearch on the harness, Gemma 4 12B)

Goal (owner): one harness that scores fully on VerilogEval spec-to-RTL, without taking long. RTL is the deliverable; tests only help it.
Metric: dev passes of 39 at 300 s per problem; then median seconds. Keep only measured gains (`results.tsv`). Read with `briefs/autoresearch.md`.

Status: **queued**, **built** (waiting to score), **kept**, **discarded** (with the number), **parked** (reason).

## Where the points are (baseline 28 of 39, 2026-11-23)

The 11 baseline failures: 7 wrong logic that compiles, 4 time-outs, 0 compile errors.
- Prose specs of clocked behaviour (q4k shift register, countbcd, fsmseq, muxdff, fsm_ps2, fsm_hdlc, lemmings3, fancytimer, q12): the largest group.
- Tables or state arrows in the spec (q3 Karnaugh map, q6 and q2afsm state transitions, rule110 truth table): 4 problems.
- Combinational misreading (always_case2: "first 1 bit" means the lowest index, as the spec's own example shows).
Problems pass in some runs and fail in others: noise is being measured (baseline repeat).

## Done

| Id | Idea | Source | Result |
|---|---|---|---|
| V | 5 raw drafts at T=0.8, majority by simulation | VRank paper | discarded, 23. One-slot server: drafts queued and timed out; ~100 s before the agent started |
| W | V + model judges where groups disagree | VRank paper | discarded, 22 |
| cold-tb | Codex writes a testbench from the spec alone; agent runs it | owner | discarded for now, 27. Wrong logic 7 to 1, time-outs 4 to 11: bugs found, not fixed in time. Testbenches 37 of 39 correct |
| X | Reply cap 3000 tokens; cut-off reply rejected | own trace reading | discarded, 25 (reverted). Runaway time-outs gone, but those problems then finished wrong |
| X+cold-tb | both | — | 27, discarded |

## Running / built

| Id | Idea | Source | Hypothesis | Status |
|---|---|---|---|---|
| Y | Agent writes; 2 sequential quick drafts cross-check; retry with the disagreement table | own | discarded, 24, median 147 s: drafts cost ~90 s per problem |
| noise | Baseline repeated | method | Gives the real keep bar for 12B | queued |
| Z | run_sim shows a waveform table of the ports at the clock edges before the first failure | MAGE, VerilogCoder; q4k trace | Turns cold-tb's found bugs into fixes: the model sees "output 3 cycles early" | built on the kept base, queued with cold-tb |

## New ideas (brainstorm), ranked by expected points per minute

1. **Header pre-fill** (own). The harness parses the spec's port list (the interface check already does) and writes `rtl/TopModule.sv` with the exact module header and `endmodule` before the agent starts. The agent fills only the body. Expect: faster first write (fewer tokens), no port mistakes. Cost: small. Speed idea first, accuracy neutral.
2. **Stop when done** (own). Many passing runs spend turns after the design is already compiled and right (re-reading the spec, rewriting). Measure turns after the last change; if large, end the run after a clean compile plus one spec check. Expect: median time down a lot, score equal.
3. **Python oracle** (own, building on D). Small models write correct Python more reliably than Verilog for prose behaviour (counters, timers, shift registers). A separate subagent writes a cycle-by-cycle Python model of the spec; the harness drives both the RTL and the Python model with the same stimulus and shows the agent a waveform table where they differ (Z's format). Different language = less correlated mistakes than two Verilog drafts. Expect: the prose-clocked group. Cost: medium; the model is local, so it costs time: give it at most 60 s and skip when it cannot run.
4. **Table compiler** (own). For specs with a Karnaugh map, truth table or state-transition list, a tool turns the table into Verilog deterministically (case statement or sum of minterms); the model only checks the table was read right. Expect: up to 4 problems (q3, rule110, q6, q2afsm), near-zero model time on them.
5. **Spec example check** (own; always_case2). Specs often contain a worked example ("8'b10010000 gives 3'd4"). Extract examples with a short model call, turn each into a check, run them against the design. Cheap, no testbench file for the agent to handle.
6. **Route by problem kind** (own). A regex classifier (no model call) on the spec: combinational, table, FSM, counter/timer, cellular automaton. Each kind gets its own short skill and a time split (e.g. thinking on only for FSMs). Expect: better use of the 300 s.
7. **Speculative decoding** (own). Ollama supports a draft model; 12B with E4B or a smaller Gemma as the draft could give 1.5x to 2x tokens per second with the same output. Pure speed; check it fits in 8 GB VRAM next to 12B.
8. **Keep the prompt cache warm** (own). Unloading the model after each problem (for memory) throws away Ollama's cache of the fixed system prompt. Measure the prefill time; if large, unload every 4 problems instead of every 1 while memory allows.
9. **Thinking only for the retry or for FSMs** (owner list, MAGE). Thinking was useless on E4B; 12B may differ.
10. **Separate checks subagent, local** (MAGE; owner wants the testbench as a helper only). Local 12B writes the checks in its own context. Only after Z shows whether the agent can use failures.
11. **On-demand Codex checks** (owner). When stuck, ask Codex for checks of the failing case. After Z.

## Industry standard (owner, 2026-11-23: accuracy and standard are as important as speed)

Full quality gate now runs Verilator lint and Yosys synthesis (OSS CAD Suite in WSL via `scripts/wsl_tool.sh`). Baseline with the full gate: 33 of 35 designs clean; 26 of 39 problems correct and clean. VerilogEval's small modules rarely trip the gate, so standards are judged mainly on the industry track (project held-out tasks, old harness easy/medium).

12. **Lint in the loop** (own). The agent's compile tool also runs Verilator and Yosys and returns the serious findings only (latch, width, multiple drivers, blocking in clocked block, non-synthesizable) as hints. A run may not end on a design Yosys cannot synthesize. Expect: quality up on the industry track; small accuracy gain where lint finds real bugs (width, drivers). Cost: one WSL call per compile (~2 to 5 s).
13. **Coding-standard skill** (own). Short always-on rules for industry RTL: one clocked process per register group, explicit reset values from the spec, no initial blocks or delays in RTL, parameters for widths, registered outputs where the spec allows, named states. Measure on the industry track; keep only if accuracy does not drop.
14. **Industry track baseline** (method). Run the project's held-out tasks and the old easy task once with the current best, with the full gate, so later ideas have a standards number to beat.

Parked: one-shot examples, self-questioning of the spec, compaction or plan mode (no evidence; traces show no context overflow: contexts stay under 16k).

## How an idea moves

Pick the highest-ranked idea whose cost fits; build it as one change on the last kept commit; score it; log it; keep (the branch advances) or discard (reset). Re-rank after every run with the new failures.
