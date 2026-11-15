# VerilogEval v2

This suite uses [NVlabs VerilogEval](https://github.com/NVlabs/verilog-eval), specification-to-RTL version 2, from `external/verilog-eval/dataset_spec-to-rtl/`. The benchmark is external data; no program from the clone is run. Only its Verilog reference and test are compiled for judging.

## Acquisition and provenance

Cloned on 2026-11-15 at commit c498220d0a52248f8e3fdffe279075215bde2da6 (156 problems: 39 dev, 117 held-out). The judge passes the benchmark's reference and rejects an empty module for the first three problems. The layout was inspected through the upstream [README](https://github.com/NVlabs/verilog-eval/blob/main/README.md), [Makefile](https://github.com/NVlabs/verilog-eval/blob/main/Makefile.in), and example test/reference. The upstream revision identified during inspection was [`c498220d0a52248f8e3fdffe279075215bde2da6`](https://github.com/NVlabs/verilog-eval/commit/c498220d0a52248f8e3fdffe279075215bde2da6). Pin that revision for a reproducible first measurement:

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

The first runner invocation fills empty lists from the clone; `--write-split` does so explicitly. Later runs reject lists that differ from the clone's sorted split. Review a revision change before regenerating the lists. Fixture tests check the split with eight synthetic prompt files.

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

The initial harness validation was performed before the dataset was available. With the pinned clone now present, `node scripts/verilog_eval_raw.mjs --check-references` passes the first three references through marker, fenced and plain extraction and the shared Icarus judge (nine checks). Reference candidates rename only `RefModule` to `TopModule`; benchmark files stay unchanged. Logs are retained under `runs/verilog-eval-raw/reference-check-<timestamp>/`.

## Raw model baseline and comparison

See [the saved PC and office server procedure](../docs/verilog-eval.md) for ordered commands. `bash scripts/verilog_eval_raw.sh <dev|heldout|all|problem-list-file> [-n max] [-s server] [-m model] [-r runs] [-t seconds]` makes exactly one streamed chat request per attempt, with no agent prompt, tools, skills, hints, compile feedback or retries. Defaults match the harness runner: `local`, one repetition, 120 seconds. It uses `src/config.ts`'s loader for the same per-server shallow merge of `config.json` and `config.local.json`, and `src/model.ts`'s reply reader for streaming; it never invokes the agent. Temperature and `extra` are taken from that server entry, with the same request precedence as the harness.

The prompt and extraction were read, not executed, from `external/verilog-eval/scripts/sv-generate` at commit `c498220d0a52248f8e3fdffe279075215bde2da6`:

- `prompts['spec-to-rtl']['system_msg']`: `"\nYou are a Verilog RTL designer that only writes code using correct Verilog syntax.\n"`.
- `main()`'s `spec-to-rtl` assembly: `"\nQuestion:\n" + prompt.strip() + "\n"`, then the default no-explanation suffix, then `"\nAnswer:\n"`. Newlines are normalized to LF as upstream's Python text-mode `open()` does. Zero examples and no rules are the defaults. The suffix (`prompt_no_explain_suffix`) is exactly `"\nEnclose your code with [BEGIN] and [DONE]. Only output the code snippet\nand do NOT output anything else.\n"`. Thus there are two newlines between the trimmed problem and `Enclose`. No model-specific alias or manual-model handling is applied to local model IDs.
- The `spec-to-rtl` extraction branch scans line by line for `[BEGIN]` and `[DONE]`, accepting code after a start marker or before an end marker on their respective lines. A start without an end yields nothing, including both markers on one line. When neither marker is found, it follows upstream's first-fence fallback (fences at column zero), or plain `module TopModule` through `endmodule` handling, preserving upstream's fallback diagnostic comment. As required for `NO_CODE`, empty/prose-only output with no module token outside comments is treated as no extractable code. It does not repair or rename the model's code.

Sampling settings follow this project's server entry, rather than upstream's temperature/top-p/token defaults. The request contains just system and user messages and uses `stream: true` with usage enabled. API keys, when configured, are used only in the authorization header. A deadline aborts the request and returns `TIME`, even when a partial reply contains code; it is not retried. Non-timeout HTTP/transport failures are `JUDGE_ERROR`, since the required verdict vocabulary has no server-error verdict.

Each attempt saves its exact request, full reply text and structured reply (reasoning, usage and finish when available), extracted `TopModule.sv` when present, `result.json`, and `judge/` logs in `runs/verilog-eval-raw/<timestamp>/<problem>/`, with `run-N/` for repetitions. Partial streamed text and reasoning survive timeouts. The shared exported `judge()` supplies exactly the harness compiler/simulator commands and flags. Raw verdicts are `PASS`, `MISMATCH`, `COMPILE_ERROR`, `NO_CODE`, `TIME`, and `JUDGE_ERROR`. The existing recorder receives suite `verilog-eval`, the actual split level, setup `raw`, and the problem as `task`. Seconds include generation and judging. Both runners end with their output folder.

`node scripts/verilog_eval_report.mjs --compare <harness folder> <raw folder>` pairs problem and attempt, prints verdicts and seconds, totals and median seconds, then the three problem pass lists. With repetitions, lists mean at least one pass for that problem, while totals count attempts. Missing attempts appear as dashes. One note names differing problem coverage, model IDs or server IDs. No `--all` guard applies to comparison, and it reads no failure logs.

`npx.cmd vitest run test/verilog-eval-raw.test.mjs` covers extraction, comparison/list/mismatch fixtures, a real local HTTP streamed request with exact messages and server fields, and a stalled stream's deadline, partial reply and absence of retries. The two-dev smoke run on 2026-11-15 used `local-fast`: `Prob004_vector2` PASS (4.7 s), `Prob008_m2014_q4h` PASS (0.8 s), 2/2 passed. The endpoint answered HTTP 200; no active connections to port 11434 were present before starting. Results: `runs/verilog-eval-raw/2026-11-15T12-50-59-624Z-6412/`. No further model scoring was run for Task Y.

Inspection of the saved smoke requests then found CRLF prompt newlines preserved by Node rather than normalized by Python. The runner now normalizes them to LF, covered by a regression test. The smoke results above predate that newline correction; the two-request limit was respected.
