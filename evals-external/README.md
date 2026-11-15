# VerilogEval v2

This suite uses [NVlabs VerilogEval](https://github.com/NVlabs/verilog-eval), specification-to-RTL version 2, from `external/verilog-eval/dataset_spec-to-rtl/`. The benchmark is external data; no program from the clone is run. Only its Verilog reference and test are compiled for judging.

## Acquisition and provenance

The sandbox clone attempt on 2026-11-15 failed to connect to github.com:443. No benchmark commit was checked out or scored. The layout was inspected through the upstream [README](https://github.com/NVlabs/verilog-eval/blob/main/README.md), [Makefile](https://github.com/NVlabs/verilog-eval/blob/main/Makefile.in), and example test/reference. The upstream revision identified during inspection was [`c498220d0a52248f8e3fdffe279075215bde2da6`](https://github.com/NVlabs/verilog-eval/commit/c498220d0a52248f8e3fdffe279075215bde2da6). Pin that revision for a reproducible first measurement:

```bash
git clone https://github.com/NVlabs/verilog-eval external/verilog-eval
git -C external/verilog-eval checkout c498220d0a52248f8e3fdffe279075215bde2da6
node scripts/verilog_eval_report.mjs --write-split
node scripts/verilog_eval_report.mjs --check-references
```

The benchmark's [licence](https://github.com/NVlabs/verilog-eval/blob/main/LICENSE) is MIT, copyright 2023–2024 NVIDIA Research Projects, with an additional MIT notice for OpenAI human-eval code. Preserve those notices with any redistribution. Benchmark contents are not vendored here; the clone is ignored. Each scoring run records the actual clone HEAD in `manifest.json` without invoking Git.

A problem named `Prob001_zero` consists of `Prob001_zero_prompt.txt` (specification), `Prob001_zero_ref.sv` (`RefModule`), and `Prob001_zero_test.sv` (hidden test, top `tb`, instantiating `TopModule`). The candidate file is `rtl/TopModule.sv`. The runner checks the selected tests' module names before making model calls. Only the prompt is copied, byte for byte, to the temporary project's protected `spec.md`; `rtl/` starts empty. Reference and test remain outside the project.

## Split policy

Sort all problem names lexically. Dev is every fourth name, using one-based positions 4, 8, 12, and so on. Heldout is the rest. Skills, hints and prompts are tuned only on dev. Heldout is measured, and its failures are never read to adjust skills.

Because acquisition failed, `verilog-eval/dev.txt` and `heldout.txt` currently contain comments, not invented problem names. The first runner invocation fills empty lists from the clone; `--write-split` does so explicitly. Later runs reject lists that differ from the clone's sorted split. Review a revision change before regenerating the lists. Fixture tests check the split with eight synthetic prompt files.

## Run and inspect

Requires Bash, Node 24, installed project dependencies, and Icarus/vvp. Node's native TypeScript support runs the existing CLIs. Compiler and simulator command arrays come from `config.json`, overridden by `config.local.json`, as in `eval_local.sh`.

```bash
bash scripts/verilog_eval.sh dev -n 2 -s local-fast -t 90
bash scripts/verilog_eval.sh heldout -s local-fast -r 1
bash scripts/verilog_eval.sh all -n 10 -s local-fast -m model-id -w workflows/example.json -t 120 -k skill-a,skill-b -r 2
bash scripts/verilog_eval.sh path/to/problem-names.txt -s local-fast
node scripts/verilog_eval_report.mjs runs/verilog-eval/<timestamp>
```

The workflow path and skill names above are placeholders; use installed workflows and skills. `-n` limits distinct problems before repetitions; `-r` repeats each problem independently. Defaults: server `local`, 120 seconds per problem, one repetition. The task text is fixed by the brief. Workflows use `--no-pause`, `design=rtl/TopModule.sv`, and `tb=tb/tb_top.sv`. The whole agent/workflow process tree has an outer wall-clock deadline; workflow step limits alone would not bound the complete problem.

Judging runs outside the temporary project against a snapshot of the saved candidate and the original hidden files. The Makefile's Icarus flags are `-Wall -Winfloop -Wno-timescale -g2012 -s tb`; simulation has a 60-second deadline. Only one final `Mismatches: N in M samples` line with positive sample count and a successful simulation can pass. A test's `TIMEOUT`, a simulation timeout, missing verdict, or missing judge executable is `JUDGE_ERROR`. Agent deadline expiration is `TIME` unless the independent judge passes. Other verdicts are `MISMATCH`, `COMPILE_ERROR`, and `NO_FILE`.

Each attempt retains `agent.log`, `result.json`, `traces/`, and `judge/` under `runs/verilog-eval/<timestamp>/<problem>/` (with `run-N/` for repetitions). Workflow traces are copied from the normal recorder by matching the unique temporary workspace. `judge/` contains the candidate snapshot and compiler/simulator logs. The existing result recorder appends suite `verilog-eval`, actual split level, usual setup, and an optional `task` problem name to `runs/results.jsonl`. The Results screen is unchanged because its shared row contract is outside this task's edit scope.

The report refuses any folder containing non-dev or unverified problems unless explicitly given `--all`. Use that override only for an intentional audit, never to tune skills from heldout failures. It prints at most 40 failed attempts in detail (three lines each), then overlapping pattern counts. Hint lines are extracted from model request messages, not from hidden judge output. The per-attempt seconds include generation and judging; the summary reports pass rate, median/mean seconds, and every verdict count.

## Validation in this sandbox

`node scripts/verilog_eval_report.mjs --self-test` tests split/verdict parsing using synthetic fixture files, option validation, process deadline enforcement, three real Icarus judge cases (correct, wrong, empty), the optional recorder task field, heldout refusal, and report length for 40 failures. Tests live in the allowed `.mjs` file because the brief permits no additional test files. These fixtures contain no benchmark material.

The three benchmark-reference checks and the two-dev-problem smoke command both stop with an explicit missing-benchmark error. The local endpoint `http://localhost:11434` answered HTTP 200, but no model requests were made because there is no dataset. Run the commands above after cloning; the reference check requires three reference candidates to pass and empty modules to fail, retaining judge logs under `runs/verilog-eval/reference-check-<timestamp>/`.
