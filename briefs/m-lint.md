# Task M: catch an output that is never driven, and declarations inside a block

You are the only task running. Files you may touch: new `src/tools/lint.ts`, `src/tools/compile.ts`, `src/tools/run_sim.ts`, new `test/lint.test.ts`, `test/tools.test.ts`. Nothing else.

Why: measured on the small local model. In 3 of 4 failed runs the model declared `output reg ... dout`, then added its own `reg dout_reg`, assigned only `dout_reg`, and never assigned `dout`. Icarus compiles this without a warning, every test reads `x`, and the model rewrote the file five times without seeing the cause. It also wrote `localparam` and `reg` declarations inside `always` blocks and got a bare "syntax error".

## Part 1: `src/tools/lint.ts`

`export function lintVerilog(text: string): string[]` returns hint lines (each starts with `Hint: `, at most three) for one Verilog source file. Strip `//` and `/* */` comments first. Plain string and regular-expression work; no parser, no dependency.

Check: an output port that nothing drives. For every module in the text that has ports:
- collect output port names from ANSI headers (`output [reg|wire|logic] [signed] [range] name`, including several names after one `output`) and from non-ANSI `output ...;` declarations in the body;
- a name counts as driven when, anywhere in that module, it is the target of `=` or `<=` (allow a bit or part select and a `{...}` concatenation that contains it; do not mistake `==`, `<=` used as a comparison inside `if (...)`, `!=`, `>=`), or it follows `assign`, or it appears inside the parentheses of a named port connection `.port(name)` of an instance, or it is declared with an initial value such as `output wire y = a & b`;
- for each output that is not driven return:
  `Hint: output <name> is never assigned, so it reads x. Assign <name> itself.`
  and, when the module assigns a signal whose name starts with `<name>_` (for example `dout_reg`, `dout_next`), append to the same line: ` You assign <other> instead; an output reg is already a register, so drop <other> and assign <name>.`

A file with no module ports (a testbench) returns nothing. When unsure whether a name is driven, treat it as driven: a false hint is worse than a missing one.

## Part 2: use it

- `compile`: when the compile succeeds, run `lintVerilog` on each file given and append the hints to the result text. The result stays ok.
- `run_sim`: when the simulation fails, run it on each file given and append the hints after the failure lines and the existing simulation hints (keep at most three hint lines in total, lint hints first).
- Read files through the same path checks the tools already use; a file that cannot be read is skipped silently.

## Part 3: declaration inside a block (`src/tools/compile.ts`)

There is already a hint for `reg`/`wire` declared inside `always`. Make it also fire when the echoed source line of a syntax error starts with `localparam`, `parameter`, `integer` or `genvar` (after leading spaces):
`Hint: declare localparam, parameter, wire, reg and integer at module level, before the always block.`
Show one hint per error line as now.

## Tests

`test/lint.test.ts`: the shadow-register case below gives the hint naming `dout` and `dout_reg`; ANSI and non-ANSI headers; output driven by `assign`, by `<=` in always, by a part select, by an instance connection, by a declaration with a value; a comparison `if (dout <= 3)` alone does not count as driving; comments are ignored; a testbench gives nothing; two modules in one file.

```verilog
module gain #(parameter W = 16) (
  input  wire clk, input wire rst,
  input  wire signed [W-1:0] din,
  output reg  signed [W-1:0] dout
);
  reg signed [W-1:0] dout_reg;
  always @(posedge clk) begin
    if (rst) dout_reg <= {W{1'b0}};
    else dout_reg <= din;
  end
endmodule
```

`test/tools.test.ts`: compile success carries the lint hint; run_sim failure carries it; the `localparam` inside `always` case gets the new hint.

Finish with `npx.cmd tsc --noEmit` and `npx.cmd vitest run`.
