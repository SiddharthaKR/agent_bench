# Experiment Z: show a waveform table of the cycles before the first failure

Read `briefs/autoresearch.md` and `docs/research/2026-11-22-rtl-agents.md` (MAGE debug window, VerilogCoder waveform tracing). Work in this worktree on its branch (it includes experiment X, the reply cap). Never call the model server and never run VerilogEval. The orchestrator scores.

## Why (measured, dev set, Gemma 4 12B)

With a given testbench, wrong logic dropped from 7 to 1, but 10 problems ran out of time. Trace of `Prob060_m2014_q4k` (a 4-flop shift register): run_sim showed lines like
`FAIL impulse_follow_2_after_rising_edge expected=1 got=0 inputs=clk:1,resetn:1,in:0,time:76000`
The model rewrote the design three times without converging: single-sample lines do not show that the output is a few cycles early or late. It needs the history of the ports.

## Build

1. In `src/tools/run_sim.ts`, on a failed simulation only:
   - Find the design module the testbench instantiates (the spec/design top module, e.g. the non-testbench module among the compiled files; reuse the harness's existing port parser in `src/tools/interface.ts` if it fits) and its instance path in the testbench.
   - Re-run the simulation once with a VCD dump of that instance's ports only. Do it without editing any file in the project: compile an extra generated module into `.build/` (e.g. `module __dump; initial begin $dumpfile(".build/wave.vcd"); $dumpvars(1, tb_top.dut); end endmodule`, added as an extra top module on the iverilog command line, which Icarus supports). Respect the configured compile/simulate commands and the existing time limits.
   - First failure time: from the first failure line, take a number after `time` / `time=` / `time:` / `@` / `at time`; if none, use the time of the last value change before the simulation printed the first FAIL (if that is not knowable, use the end of the simulation).
   - Find the clock (an input port named clk, clock, or matching /cl(oc)?k/i). For a clocked design, sample all ports just before each rising clock edge (value at the edge, before it changes) for the 8 edges up to and including the first failure time. For a design without a clock, list the last 8 value changes of the inputs up to that time with the outputs after each.
   - Append to the run_sim result, after the existing failure lines and before hints:
     ```
     Waveform of TopModule before the first failure (time 76000), one row per rising clk edge:
     time  | resetn in | out
     36000 | 1      1  | 0
     ...
     ```
     Values in binary for widths up to 8, otherwise hex. At most 10 rows, at most 12 columns (inputs first, then outputs); the row at the failure time is marked with `<- first FAIL`.
   - Any problem (no clock found, no instance, VCD missing, parse error) silently skips the table; run_sim's result is otherwise unchanged. The table never appears on a passing simulation.
2. Tests (vitest, real Icarus at `C:/iverilog/bin`): a shift register that is one stage short with a small self-checking testbench printing `time:` in its FAIL line, where the table shows the expected rows and the marker; a combinational design; a FAIL line without a time; no table on a pass; project files unchanged (no dump file left outside `.build/`).

## Done when

`npx.cmd tsc --noEmit`, `npx.cmd vitest run --maxWorkers=2`, `bash scripts/check_evals.sh` pass. Write `docs/rounds/2026-11-23-Z.md` (short: what, tests, choices, one real example of the table). Leave changes uncommitted if git refuses; the orchestrator commits.
