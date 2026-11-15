# Task Q: a held-out set of scoring tasks

You are the only task running. Files you may touch: new folders under `evals/` and `evals-ref/`, `scripts/eval_local.sh`, `scripts/check_evals.sh`, new `scripts/eval_set.sh`, `README.md` (one short section). Do not edit `agents/`, `src/`, `workflows/`, `PLAN.md`.

Why: the skills and hints were tuned by reading failures on three tasks (`gain`, `counter`, `fir4`). To know whether the gains carry over, we need tasks that were never used for tuning. Do not read `agents/fpga/skills/` or `agents/fpga/prompt.md` while writing these tasks, and do not shape a task around them.

## Tasks

Six tasks in the same layout as `evals/gain` (`task.md`, `spec.md` with the exact module header, `tb/`, empty `rtl/`, `eval.json`), each with a reference answer in `evals-ref/<name>/`. Add `"set": "heldout"` to their `eval.json`, and `"set": "tuning"` to the three existing ones.

| Name | Level | What |
|---|---|---|
| `pwm` | easy | 8-bit PWM: free-running counter, `duty` input latched at counter wrap, output high while counter < latched duty, synchronous reset |
| `seqdet` | easy | detector for the serial pattern 1011 with overlap, one-clock `hit` pulse, synchronous reset; Moore or Mealy as the spec fixes exactly |
| `regbank` | medium | four 12-bit signed registers, write strobe with 2-bit address, registered read data on a 16-bit bus with sign extension, one read-only status register, defined reset values |
| `fifo` | medium | synchronous FIFO, depth 8, width 8, `full`, `empty`, `count`; write when full and read when empty are ignored; simultaneous read and write on a full and on an empty FIFO defined in the spec |
| `accum` | medium | signed accumulator: 12-bit signed input with `in_valid`, 16-bit signed saturating sum, `clear` has priority, registered `overflow` flag that stays set until `clear` |
| `uart_tx` | medium | UART transmitter 8N1, baud divider parameter (small in the testbench), `start`/`busy`, LSB first, idle high |

Testbenches: plain Verilog for Icarus, inputs driven on the falling edge, `PASS <name>` or `FAIL <name> got %0d wanted %0d` per check, at least 10 checks covering the edge cases the spec names, final `ALL TESTS PASSED` or `<n> TESTS FAILED`, then `$finish`. A watchdog `$finish` so a hung design cannot run forever. The task text follows the pattern of `evals/gain/task.md`.

Each spec must be complete and unambiguous on its own: every port, reset value, priority and cycle timing stated, with one worked example where timing matters. Have a second look at each spec against its testbench for anything the testbench checks that the spec does not state.

## Scripts

- `scripts/check_evals.sh` already checks every reference; all nine must print ok. For each new testbench, also confirm by hand that a plausible wrong design fails (say which fault you tried in the report).
- `scripts/eval_local.sh`: record the set in the result if the results script has a field for a free-text tag; otherwise leave recording as it is.
- New `scripts/eval_set.sh <tuning|heldout> [options passed on to eval_local.sh]`: runs `eval_local.sh -e <name>` for every task of that set, then prints one summary table: task, level, passed of runs, seconds per run. Pass through `-n`, `-s`, `-w`, `-t`, `-k`, `-m`.
- `README.md`: a short section "Scoring tasks" explaining the two sets and the rule: skills and hints are tuned only on the tuning set; the held-out set is only measured.

Finish with `bash scripts/check_evals.sh` and `npx.cmd vitest run`.
