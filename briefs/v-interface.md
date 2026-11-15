# Task V: check the module header against the spec, and two compile hints

You are the only task running. You may edit `src/types.ts` and `src/shared/api.ts` if a type needs a field. Do not edit `agents/`, `workflows/`, `evals/`, `PLAN.md`.

Why: on the old harness's easy task a hidden judge instantiates the module by the header given in the spec. One run compiled and simulated with the model's own testbench and still got COMPILE_ERROR from the judge; the likely cause is a changed port list. A spec that gives an exact module header is a contract, and the harness can check it without a model.

## Part 1: interface check (new `src/tools/interface.ts`)

- `specHeaders(specText)`: find module headers in the spec's fenced code blocks (a block may contain only the header, with no `endmodule`). ANSI style only. For each: module name and, per port, direction, name, `signed` or not, and the range text.
- `checkInterface(specText, designText)`: for each spec header, find the module of the same name in the design and return hint lines (each starts with `Hint: `, at most two):
  - module missing: `Hint: the spec defines module <name>; this file defines <names found>. Use the name from the spec.`
  - ports missing, extra, or differing in direction, signedness or width: `Hint: module <name> must keep the ports of the spec exactly. Missing: a, b. Extra: c. Different: d (spec: input signed [13:0], file: input [13:0]).` Leave out the empty parts.
  - Ignore `reg`, `wire` and `logic`, comments, order, and whitespace. Compare ranges after evaluating simple integer expressions (`14-1` equals `13`, `W-1` compared as text when it contains a name). Parameters are not compared.
  - When the design is non-ANSI or cannot be read with confidence, return nothing.

Where it runs:
- The run remembers the text of every `.md` or `.txt` file the agent read with `read_file` (add what is needed to the tool context). `compile`, on success and on failure, and `run_sim` on failure, run the check for each design file given against those texts and append the hints, before other lint hints, within the existing cap.
- The quality gate: `npm run quality -- --spec <file> <design files>` reports rule `interface` as a failure. `scripts/eval_local.sh` passes the eval's `spec.md`; `scripts/check_evals.sh` too (all nine references must still pass; if a spec's header and its reference disagree, report it and do not change either).
- `scripts/verilog_eval.sh` (`scripts/verilog_eval_report.mjs --run`): VerilogEval prompts describe the interface in prose or in a header; pass the prompt as the spec only if `specHeaders` finds a header in it.

## Part 2: two compile hints (`src/tools/compile.ts`)

- An `Include file <x> not found` message: `Hint: do not use \`include. Give every file to compile or run_sim in the files argument instead.`
- A message containing `has indefinite width` for a concatenation operand: `Hint: inside { } every constant needs a size, for example 4'd14, not 14 or 'sd14.`

## Tests

- Header parsing from a spec block without `endmodule`; several headers; expressions in ranges.
- Each difference kind, the ignored differences, the two-hint cap, the non-ANSI skip.
- Tool integration: a spec read earlier in the run produces the hint on compile; no spec read, no hint.
- The two compile hints.
- Quality gate with `--spec`.

Finish with `npx.cmd tsc --noEmit`, `npx.cmd vitest run` and `bash scripts/check_evals.sh`.
