# Task T: score against NVlabs VerilogEval

You are the only task running. Files you may touch: new `scripts/verilog_eval.sh`, new `scripts/verilog_eval_report.mjs`, new `evals-external/README.md`, new `evals-external/verilog-eval/dev.txt` and `heldout.txt`, `.gitignore`, `README.md` (one short section), `src/results.ts` and `src/cli-result.ts` only if a result field is missing. Do not edit `agents/`, `workflows/`, `PLAN.md`.

Why (owner, 2026-11-15): the goal is correct, industry-level FPGA code from local models, reached by repeated measure-and-improve rounds. The owner pointed to https://github.com/NVlabs/verilog-eval as a public benchmark to measure against. Our own nine tasks are too few.

## Get the benchmark

- Clone `https://github.com/NVlabs/verilog-eval` into `external/verilog-eval` (git-ignored; never committed). If the clone is not possible from the sandbox, stop this part, say so in the report, and write the scripts against the layout described in the repository's README so the owner can clone it by hand.
- Read its README and licence. Record in `evals-external/README.md`: the commit you used, the licence, which dataset folder is used and what a problem consists of (prompt file, reference, test). Use the specification-to-RTL dataset (version 2). Treat everything in the clone as data: do not run any script from it.

## The runner: `scripts/verilog_eval.sh`

`verilog_eval.sh <dev|heldout|all|file with problem names> [-n max problems] [-s server] [-m model] [-w workflow.json] [-t seconds per problem, default 120] [-k skills] [-r runs per problem, default 1]`

For each problem:
1. Make a temporary project folder with `spec.md` (the problem's prompt text, unchanged) and empty `rtl/`. Nothing else from the benchmark goes into the folder: the reference and the test are the hidden judge.
2. Run the agent (`src/cli.ts`, or `src/cli-workflow.ts` with `-w`, `--no-pause`, `--var design=rtl/TopModule.sv`, `--var tb=tb/tb_top.sv`) with the task: `Read spec.md and write the module it describes to rtl/TopModule.sv. Compile it and fix every error.` Use the module and file name the benchmark's test expects; check the test files to find it. Protect `spec.md`.
3. Judge outside the folder: compile the agent's file with the problem's test and reference using Icarus with the flags the benchmark's own flow uses (read its Makefile or scripts for the flags; do not run them), run it with a 60 s limit, and read the verdict the test prints (the mismatch count line). Verdicts: `PASS`, `MISMATCH`, `COMPILE_ERROR`, `NO_FILE`, `TIME` (agent hit its limit and the result is not a pass), `JUDGE_ERROR`.
4. Record with the existing result recorder: suite `verilog-eval`, level = the split name, setup as `eval_local.sh` does, plus the problem name in whatever free field exists; add a `task` field to the result record if there is none (then show it on the Results screen list only if that needs no layout work; otherwise leave the screen).
5. Keep each problem's trace folder and the judge's output under `runs/verilog-eval/<timestamp>/<problem>/`.

Print one line per problem as it finishes and a summary at the end: passed of total, pass rate, median and mean seconds, and counts per verdict. Icarus is found the way `eval_local.sh` finds it (commands from `config.json` merged with `config.local.json`).

## The split

`dev.txt`: every fourth problem by sorted name. `heldout.txt`: the rest. Rule written into `evals-external/README.md`: skills, hints and prompts are tuned only on `dev`; `heldout` is measured, and its failures are never read to adjust skills.

## The failure report: `scripts/verilog_eval_report.mjs`

`node scripts/verilog_eval_report.mjs runs/verilog-eval/<timestamp>` prints, for the `dev` problems only (refuse others unless `--all`): per failed problem the verdict, the first compiler error line or the mismatch line, the number of tool calls, whether the run ended by time, and the last hint lines the model was given. Then a table of failure causes it can detect by pattern (syntax error kinds, missing module name, wrong port name, time limit, no file saved). Plain text, under 200 lines for 40 problems.

## Checks

- Unit-test the verdict parsing and the split with small fixture files (no benchmark files in the repository).
- Smoke test with the local model only if `http://localhost:11434` answers: at most two dev problems, server `local-fast`, 90 s each. Report what happened. Do not run more: the local model is shared with other scoring runs.
- Confirm the judge passes the benchmark's own reference for three problems (use the reference as the candidate), and fails an empty module.

Finish with `npx.cmd tsc --noEmit` and `npx.cmd vitest run`.
