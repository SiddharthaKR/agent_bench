# Task P: files the agent may not change

You are the only task running. You may edit `src/shared/api.ts`. Do not edit `agents/`, `PLAN.md`.

Why: measured on the small local model. After writing a correct design, the model overwrote the given testbench `tb/tb_gain.v` with its own broken one and spent the rest of its time limit fixing that file. The task text said not to change it; a rule in text is not enough.

## Behaviour

A run has a list of protected paths (project-relative files, or folders ending in `/`). `write_file` and `replace_lines` on a protected path do not write; they return an error result:

`<path> is given and must not be changed. Fix the design instead, and run run_sim with this file.`

for a path whose name looks like a testbench (`tb_*`, `*_tb.*`, or inside a `tb/` folder), otherwise:

`<path> is given and must not be changed.`

The check uses the same path normalisation as the tools' existing path checks, is case-insensitive on Windows, and also applies to sub-agents started with `ask_agent`. In an interactive session the blocked call never becomes an approval proposal.

## Where the list comes from

- Workflow: top-level `protect?: string[]` in `Workflow`; entries may use `{placeholders}`. Applies to every agent step.
- Command line: `--protect a,b` on `npm run agent` and `npm run workflow` (added to the workflow's own list).
- Code API and engine session options: the matching option.
- `workflows/retry-until-pass.json`, `workflows/fpga-fast.json`, `workflows/fpga-block.json`: for the first two add `"protect": ["{tb}"]`. Leave `fpga-block.json` alone (its testbench step writes the testbench).
- `scripts/eval_local.sh`: pass `--protect <tb from eval.json>,spec.md` for single-agent runs too.
- `scripts/h_task.sh`: read it first. If the task setup gives the agent files that it must not change (a spec, a provided testbench), protect those; say in your report what you protected and why. Do not open the old harness's `harness/judge` folder.

The Workflows screen must not drop `protect` when saving. Check; fix only if it does.

## Tests

- A protected file is not written by either tool and the text is as above; an unprotected one is; a folder entry protects everything under it; `..` and case tricks do not get around it.
- Workflow placeholder filling; command-line parsing; sub-agent inherits the list; session does not raise a proposal.

Finish with `npx.cmd tsc --noEmit` (root and `web/`) and `npx.cmd vitest run`.

## Part 2: three more hints seen in failed FIR runs (src/tools/compile.ts, src/tools/lint.ts, src/tools/sim_hints.ts and their tests)

1. Compile hint. The model writes a negative sized constant as `16'sd-32768` and gets a bare "syntax error". When the echoed source line of a syntax error contains a sized literal immediately followed by a minus sign inside the number (pattern like `'sd-`, `'d-`, `'sh-`, `'h-`), add:
   `Hint: put the minus sign before the size: -16'sd32768, not 16'sd-32768.`
2. Lint (`lintVerilog`). A limit declared without `signed` and compared with `<`, `>`, `<=` (as comparison) or `>=` makes the comparison unsigned, so every result saturates. For each `localparam` or `parameter` that is declared with a range but without `signed`, or whose value is an unsigned based literal such as `16'h8000` or `16'd32767` with no `signed` in the declaration, and that appears as an operand of a relational comparison inside an `if (...)` or a `?:` condition, return:
   `Hint: <NAME> is unsigned, so the comparison with it is unsigned and wrong for negative values. Declare it as localparam signed [..] <NAME>.`
   Skip the hint when the other operand is clearly unsigned by declaration (a `reg`/`wire` declared without `signed`), or when unsure. Keep the three-hint cap; an undriven output hint comes first.
3. Simulation hint (`simHints`). When at least three failing lines have the same `got` value while their `wanted` values differ, and that value is not `x`, return:
   `Hint: every result is <value>. If that is a saturation limit, the comparison is probably unsigned or the limits are swapped; declare limits and compared values signed.`
   Keep the cap of two simulation hints; the late-output hint has priority over this one.

Tests for each, including this real case for the lint:

```verilog
localparam [15:0] MAX_16 = 16'd32767;
localparam [15:0] MIN_16 = 16'h8000;
wire signed [31:0] shifted_val;
always @(posedge clk) begin
	if (shifted_val > MAX_16) dout <= MAX_16;
	else if (shifted_val < MIN_16) dout <= MIN_16;
	else dout <= shifted_val[15:0];
end
```
The three reference designs under `evals-ref/` must still give no hints.
