# Task U: a quality gate for industry-level RTL

You are the only task running. Files you may touch: `src/tools/lint.ts`, new `src/tools/quality.ts`, new `src/cli-quality.ts`, `package.json` (one script line `quality`), `config.json` (new optional commands), `src/config.ts`, `src/shared/api.ts` (config type only), `scripts/eval_local.sh`, `scripts/check_evals.sh`, tests, `README.md` (one short section). Do not edit `agents/`, `workflows/`, `PLAN.md`.

Why (owner, 2026-11-15): passing a testbench is not enough; the goal is industry-level FPGA code. We need a check, separate from the functional verdict, that says whether a design is clean synthesizable RTL. It must run without a model, in well under a second for a small file.

## What it checks

`npm run quality -- <files...>` (and `qualityReport(files)` in `src/tools/quality.ts`) prints findings as `<file>:<line>: <rule>: <message>` and ends with `QUALITY PASS` or `QUALITY FAIL (<n> findings)`; exit code 1 on fail. Rules, each with an id:

Own checks (plain text analysis in `src/tools/lint.ts`, comments and strings stripped, no parser; when unsure, report nothing):
- `latch`: in an `always @*` (or `always @(*)`, `always_comb`) block, a reg assigned in some branch but not in all (an `if` without `else`, a `case` without `default`) and with no default assignment before the branch.
- `blocking-in-clocked`: `=` assignment to a signal inside `always @(posedge ...)`/`always_ff` (ignore loop variables declared as integer or genvar).
- `nonblocking-in-comb`: `<=` assignment inside `always @*`.
- `multi-driver`: the same reg assigned in more than one always block, or a signal driven by both `assign` and an always block.
- `sensitivity`: a combinational `always @(a or b ...)` list that is not `@*`.
- `delay-in-design`: `#<number>` in a file that has module ports (a design, not a testbench).
- `initial-in-design`: an `initial` block in a design file (report as a note, not a failure: FPGA tools accept it).
- `no-reset`: a clocked block that assigns a register named `*_valid`, `valid*`, `state*`, `*_state` or a counter (`*cnt*`, `*count*`) and has no reset branch, when the module has a port named `rst`, `rst_n`, `reset` or `resetn` (note, not a failure).
- `undriven-output` and `unsigned-limit`: the existing lint hints, reported as findings.
- `width-literal`: an unsized based constant such as `'h1F` or `'d5` in a design file (note).

External tools, used only when a command is configured and the program exists (skip silently otherwise, and say in the summary line which ran):
- `commands.lint` in config, default `["verilator", "--lint-only", "-Wall", "{files}"]`: each warning becomes a finding with rule `verilator:<code>`.
- `commands.synth` in config, default `["yosys", "-q", "-p", "read_verilog -sv {files}; synth; check -assert"]`: a failure becomes one finding `synth` with the first error line.
- Icarus with `-Wall`: warnings become findings with rule `iverilog`.

Failures are: latch, blocking-in-clocked, nonblocking-in-comb, multi-driver, sensitivity, delay-in-design, undriven-output, unsigned-limit, synth, and Verilator codes LATCH, MULTIDRIVEN, BLKSEQ, COMBDLY, WIDTH, UNDRIVEN, CASEINCOMPLETE. Everything else is a note and does not fail the gate.

## Where it is used

- `scripts/eval_local.sh`: after the functional verdict, run the gate on the design file and record `quality: "pass" | "fail" | "skipped"` and the count of findings in the result (add the fields to the result record; show nothing new on the Results screen unless it is a one-line change). Print it on the run line: `run 1: PASS, quality pass, ...`. The functional verdict is unchanged by it.
- `scripts/check_evals.sh`: run the gate on every reference answer and print it. All nine references must give `QUALITY PASS`; if one does not, the check is wrong or the reference is: say which, fix the check, and leave the reference alone unless it truly has the defect (then report it).

## Tests

One small fixture per rule that must fire, and one clean design per rule that must not. The nine reference designs and the three correct patterns in `agents/fpga/skills/fixed-point.md`, `agents/fpga/skills/pipelining.md` and `agents/fpga/skills/reset-and-state.md` (extract the code blocks in the test) give no failures.

Finish with `npx.cmd tsc --noEmit`, `npx.cmd vitest run` and `bash scripts/check_evals.sh`.
