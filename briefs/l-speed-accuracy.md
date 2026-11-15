# Task L: retries that really retry, per-step speed settings, simulation hints, two more scoring tasks

You are the only task running. You may edit `src/shared/api.ts` for part 1. Do not edit `agents/`, `workflows/`, `PLAN.md`, `README.md`.

Why: measured on the small local model, a workflow run with `--max-seconds 150` ended when its first agent step hit the time limit, so the "retry with a fresh start" never happened (1 of 4 passed). And the model's usual wrong answer is an output that arrives one or two clocks late; it does not see that from the failure lines.

## Part 1: workflow steps (src/shared/api.ts, src/workflow.ts, and wherever `WorkflowDeps.runAgent` is implemented: src/engine.ts, src/cli-workflow.ts, src/index.ts)

Add optional fields to `AgentStep`:

```ts
/** Time limit for this step, in seconds. */
maxSeconds?: number;
/** Extra request fields for this step, merged over the server's own `extra`. */
extra?: Record<string, unknown>;
/** Settings used instead when this step runs again after a failed check. */
retry?: { model?: string; temperature?: number; maxTurns?: number; maxSeconds?: number; extra?: Record<string, unknown> };
```

Behaviour:
- When an agent step runs for the second or later time in a run (the run looped back to it), the fields in `retry` replace the step's own. `retry.extra` is merged over `extra`.
- `maxSeconds` order: step (or its retry value), then the run-wide value (`--max-seconds` on the command line, the engine's run option), then the agent's own.
- `--max-seconds` is therefore a limit per agent step, not for the whole workflow. Say so in the CLI usage text.
- An agent step that ended because of its time limit or its tool-call limit does NOT end the workflow when a later command step exists: log one line ("Stopped at the time limit; the checks decide.") and go on to the next step. The command steps decide pass or fail and may loop back. A model or server error still fails the run as now. Extend the `runAgent` result with `limit?: "time" | "turns"` to carry this.
- `validateWorkflow`: positive numbers for both `maxSeconds`; same checks for `retry` fields as for the step's own.
- The Workflows screen (`web/src/workflows/*`) must not drop these fields when it saves a workflow. Check; fix only if it drops them. No new controls.

## Part 2: simulation hints (new `src/tools/sim_hints.ts`; used by `src/tools/run_sim.ts` and by the failure text of a workflow command step in `src/workflow.ts`)

`export function simHints(lines: string[]): string[]` returns at most two short hint lines, each starting with `Hint: `.

1. Late output. From the failure lines in order, read pairs with the pattern `got <value> wanted <value>` (also accept `expected` for `wanted`, and `=`/`:` after either word; case-insensitive). If at least two failing lines have a `got` equal to the `wanted` of the line just before it (or the one two before), return:
   `Hint: each result equals an earlier test's expected value, so the output is late by one or more clocks. Keep one registered stage: compute intermediate values with assign or in always @* using =, and assign only the output with <= in the clocked block.`
2. Unknown value. If any `got` value is `x`, `X`, `z` or contains only x/z digits, return:
   `Hint: x means a signal was read before it was assigned, has no driver, or has two drivers. Check reset and that every used signal is declared and driven once.`

`run_sim` appends the hints after its failure lines. The workflow command step appends them to its failure text (this text is what the next agent attempt receives). Compute hints from all failure lines, not only the ten shown.

## Part 3: two more local scoring tasks (evals/, scripts/eval_local.sh, new scripts/check_evals.sh, new evals-ref/)

Today `scripts/eval_local.sh` is hard-wired to `evals/gain`. Make it take `-e <name>` (default `gain`) and read `evals/<name>/eval.json`:

```json
{ "level": "easy", "design": "rtl/gain.v", "tb": "tb/tb_gain.v" }
```

Use these for the files, the `--var design=... --var tb=...` values, the restored original testbench, and the recorded `--suite <name> --level <level>`. Add `eval.json` for gain. Keep every existing option.

Add two tasks in the same layout as `evals/gain` (`task.md`, `spec.md`, `tb/`, empty `rtl/`):

- `evals/counter` (easy, no arithmetic tricks): 8-bit up/down counter with synchronous reset, `load` with `din`, `en`, `up`; priority reset > load > enable; a registered `wrap` flag that is high for one clock after the count wrapped past either end. Spec gives the exact module header.
- `evals/fir4` (medium): 4-tap FIR, signed 16-bit samples, four signed 8-bit coefficient inputs in Q7, `in_valid`/`out_valid`, sample history cleared by synchronous reset, result `sum >>> 7` saturated to signed 16 bits, registered output exactly one clock after `in_valid`, history shifts only when `in_valid` is high. Spec gives the exact module header and one worked numeric example.

Testbenches: plain Verilog for Icarus, drive inputs on the falling edge, print `PASS <name>` or `FAIL <name> got %0d wanted %0d` per check, end with `ALL TESTS PASSED` or `<n> TESTS FAILED`, then `$finish`. At least 8 checks each, covering reset, the edge cases (wrap both ways, load priority; positive and negative saturation, truncation of a negative result, valid gaps).

Reference answers go in `evals-ref/<name>/<design file name>` (also add one for gain). They are never copied into a run's folder. `scripts/check_evals.sh` compiles and simulates each reference with its testbench (commands from `config.json` merged with `config.local.json`, as `eval_local.sh` does) and prints `<name>: ok` or `<name>: BROKEN`; exit code non-zero if any is broken. Run it and make all three print ok. On this PC Icarus is at `C:/iverilog/bin` and `config.local.json` already points to it. Also confirm by hand that each new testbench FAILS for a design whose output is one clock late; say so in your report.

## Tests

- `test/workflow.test.ts`: limit result continues to the checks; a model error still fails; retry settings are passed on the second round only; `maxSeconds` order; validation.
- `test/sim_hints.test.ts`: late by one, late by two, x value, no hint for unrelated failures, at most two hints. Use this real output as one case:

```
FAIL unity got x wanted 160
FAIL times_two got 160 wanted 200
FAIL negative got 200 wanted -200
FAIL saturate_neg got 32767 wanted -32768
FAIL truncate got 32767 wanted 3
```
- Update `test/run_sim` tests for the appended hints.

Finish with `npx.cmd tsc --noEmit` (root and `web/`), `npx.cmd vitest run`, and `bash scripts/check_evals.sh`.
