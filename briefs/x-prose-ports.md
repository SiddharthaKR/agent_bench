# Task X: read a port list written as a bullet list

You are the only task running. Files you may touch: `src/tools/interface.ts`, `test/interface.test.ts`, `scripts/verilog_eval_report.mjs` (only the place that decides whether to pass the prompt as the spec). Nothing else.

Why: the interface check compares the design's module header with a Verilog header in the spec. Many specs, including every VerilogEval prompt, give the interface as prose:

```
I would like you to implement a module named TopModule with the following
interface. All input and output ports are one bit unless otherwise
specified.

 - input  clk
 - input  in  (32 bits)
 - output out (32 bits)
 - output reg [7:0] q
```

On the VerilogEval dev set the small model renamed a port (`Q` written as `q_out`) and changed a width (`ena` 3 bits written as 1 bit); both cost the problem.

## What to add

`specHeaders(specText)` also returns a header built from a bullet list when the spec has no fenced Verilog header for that module:

- The module name comes from a sentence containing `module named <name>` or `module called <name>` (also with backticks around the name). No such sentence: no header.
- Port lines are consecutive list items (`-`, `*` or `1.`) whose text starts with `input`, `output` or `inout`, then optional `wire`/`reg`/`logic`/`signed`, then either a `[msb:lsb]` range and a name, or a name followed by an optional width in words: `(32 bits)`, `(1 bit)`, `(8-bit)`, `[8 bits]`. Text after that on the line is ignored.
- No width given means one bit. A width in words `N` equals the range `[N-1:0]`; compare widths as numbers of bits so `(8 bits)` matches `[7:0]` and `[8-1:0]`.
- `signed` is compared only when the bullet says `signed`.
- If fewer than two port lines are found, return no header.

`checkInterface` works unchanged on such a header and reports with the same hint wording. For a bullet-list header, show the spec side as written in the spec, for example `(spec: output ena (3 bits), file: output ena)`.

`scripts/verilog_eval_report.mjs`: pass the prompt as the spec whenever `specHeaders` finds a header in it (it will now, for the prose prompts).

## Tests

- The example above parses to four ports with the right directions and widths.
- A design with the same ports gives no hint; a renamed port, a changed width, an added clock and reset give the hint naming them.
- `(1 bit)`, `(8-bit)`, a `[7:0]` bullet, backticked names, numbered list items.
- A spec with both a fenced header and a bullet list for the same module uses the fenced header.
- Prose with only one port line, or without a module-name sentence, gives no header.
- The nine eval specs still produce the same headers as before.

Finish with `npx.cmd tsc --noEmit`, `npx.cmd vitest run` and `bash scripts/check_evals.sh`.
