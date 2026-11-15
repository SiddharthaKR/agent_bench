# Task W: help the testbench writer

You are the only task running. You may edit `src/types.ts` and `src/shared/api.ts`. Do not edit `agents/`, `workflows/`, `evals/`, `PLAN.md`.

Why (owner, 2026-11-15): correct RTL is what matters; the testbench is secondary, but the testbench writer needs help. Measured on the small local model: its testbenches are 7,000 to 11,000 characters, often do not compile (declarations inside tasks and `initial` blocks, invented `include` lines, wrong widths on the instance), and fixing them eats most of a run. The parts it gets wrong are boilerplate that can be generated from the design's module header.

## Part 1: `tb_skeleton` tool (new `src/tools/tb_skeleton.ts`; reuse the header parser in `src/tools/interface.ts`)

Arguments: `design` (required, the design file), `path` (required, the testbench file to create), `module` (optional, when the file has several modules).

It writes a complete, compiling testbench skeleton and returns a short result: the file name, the line numbers of the section to fill in, and the names of the helper tasks. It refuses to overwrite an existing file (error result telling the agent to edit the existing one). Content, plain Verilog-2001:

- `` `timescale 1ns/1ps ``, `module tb;`
- one `reg` per input and one `wire` per output, with the widths and signedness of the design's ports; parameters of the design are repeated as `localparam` with their default values when the port ranges use them;
- clock: a port whose name is `clk`, `clock`, or starts or ends with `clk`/`clock` (also `clk_i`): `initial clk = 0; always #5 clk = ~clk;`. No clock port found: no clock, and `tick` below becomes `#10`;
- reset: a port named `rst`, `reset`, `rstn`, `rst_n`, `resetn`, `reset_n`, with `_i` suffix allowed; active low when the name has `n` after `rst`/`reset`. The skeleton asserts it for three clocks and releases it;
- all other inputs start at 0;
- the instance with every port connected by name;
- `integer errs, checks;` and these helper tasks, complete and correct:
  - `tick` : wait one clock (drives happen on the falling edge: `@(negedge clk);`);
  - `check(name, got, wanted)` with a 64-bit signed `got` and `wanted` and a 32-character name: prints `PASS <name>` or `FAIL <name> got %0d wanted %0d`;
  - `check_hex(name, got, wanted)` for 64-bit unsigned values printed in hex;
- a marked section inside the main `initial` block:
  ```
  		// ---- CHECKS BEGIN: write stimulus and checks only between these two lines ----
  		// example: din = 16'sd100; tick; tick; check("positive", dout, 100);
  		// ---- CHECKS END ----
  ```
  The example line uses the first non-clock, non-reset input and the first output of this design;
- after the section: `ALL TESTS PASSED` when `errs == 0 && checks > 0`, otherwise `<n> TESTS FAILED` (and `FAIL no checks ran` when `checks == 0`), then `$finish`;
- a watchdog `initial begin #2000000; $display("FAIL timeout"); $finish; end`.

The generated skeleton must compile and run against its design as generated (it then reports `FAIL no checks ran`). Test that with Icarus for the nine reference designs under `evals-ref/` when Icarus is available (`C:/iverilog/bin`), and say so in the report.

Register the tool so an agent gets it when its `agent.json` lists `tb_skeleton`. Add its help line in the same style as the other tools.

## Part 2: testbench hints (`src/tools/compile.ts`, `src/tools/lint.ts`)

A file is a testbench when its modules have no ports. For compile errors located in a testbench file:
- the echoed source line is inside a `task`, `function`, `initial` or `always` body and looks like a declaration (`reg`, `wire`, `integer`, `localparam`, `parameter`, `signed [`, `local `, `logic`, `real`): `Hint: in a testbench declare reg, wire, integer and localparam at module level. Inside a task only input lines come before begin.`
- an unknown port on the instance (Icarus: `port ... is not a port of`): `Hint: connect only the ports of the design's module header; read the header again.`
- when a compile of design plus testbench fails only in the testbench file, start the result with: `The design compiled; the errors are in the testbench <file>. Fix only the testbench.` When it fails only in the design, the matching sentence for the design.

Lint for a testbench file (no failure, hints only, within the cap): no `$finish` anywhere; no `$display` containing `PASS` or `FAIL`.

## Part 3: protect per step (`src/shared/api.ts`, `src/workflow.ts`, runners)

`AgentStep.protect?: string[]`, with placeholders, added to the workflow's own list for that step only (also allowed in `retry`). So a testbench step can protect `{design}`. Validate entries are not blank. The Workflows screen must not drop it.

## Tests

Skeleton: a clocked design with active-low reset and parameters, a combinational design with no clock, signed ports, several modules with `module` given, refusal to overwrite, the marked section line numbers in the result. Hints: each case above. Step protect: applies to that step only.

Finish with `npx.cmd tsc --noEmit` (root and `web/`) and `npx.cmd vitest run`.
