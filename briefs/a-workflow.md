# Task A: workflow runner

Read `briefs/common.md` first and follow it.

Create ONLY: `src/workflow.ts`, `test/workflow.test.ts`, `workflows/fpga-block.json`.

Read: `src/shared/api.ts` (Workflow, WorkflowStep, AgentStep, CommandStep, OnFail, WorkflowRunState, StepRun, WorkflowEvent), `src/shared/engine.ts` (WorkflowRun), `src/types.ts` (Exec, ExecResult).

## What it is

A workflow is an ordered list of steps. Plain code runs them in order; the language model is used only inside agent steps. Pass or fail always comes from a command's result or from whether an agent step finished, never from the model claiming success.

## Exports

```ts
import type { AgentStep, Workflow } from "./shared/api.ts";
import type { WorkflowRun } from "./shared/engine.ts";
import type { Exec } from "./types.ts";

export interface WorkflowDeps {
	/** Absolute project folder. Commands run with this as the working directory. */
	workspace: string;
	exec: Exec;
	/**
	 * Runs one agent step with a fresh context and resolves when it ends.
	 * ok is false when the agent could not finish (error, loop, limit, stopped).
	 * text is the agent's last message. onLine receives one short line per tool call.
	 */
	runAgent(step: AgentStep, task: string, signal: AbortSignal, onLine: (line: string) => void): Promise<{ ok: boolean; text: string }>;
}

export function createWorkflowRun(id: string, workflow: Workflow, task: string, deps: WorkflowDeps): WorkflowRun;
export function fillPlaceholders(text: string, vars: Record<string, string>): string;
export function validateWorkflow(workflow: Workflow): string[];
```

## Rules

- `fillPlaceholders`: replaces every `{name}` whose name is a key of `vars` with its value. Unknown `{name}` stays as written. The runner calls it with `{ ...workflow.vars, task }`, so `{task}` is the run's task text.
- `validateWorkflow` returns a list of problem sentences (empty = valid): no steps; duplicate step ids; empty step name; agent step with empty `agent` or `task`; command step with an empty `command`; `onFail.goTo` that is not the id of this step or an earlier step; `onFail.maxRounds` < 1.
- `start()`: if validation fails, status becomes `failed` and each problem is added to `log`. Otherwise: status `running`, round 1, every step `waiting`, then run from the first step. Calling `start()` while running or paused does nothing. Before the first command step runs, create `<workspace>/.build` (recursive, ignore errors).
- The run loop executes one step at a time:
  - Mark it `running`, set `current` to its id, emit state.
  - `once`: if the step has `once: true` and already has a `passed` result from an earlier round, mark it `kept` (text `Kept from round N.`), do not run it, do not pause on it, continue.
  - Agent step: task text = `fillPlaceholders(step.task, vars)`. If this round was started by a failure, append a blank line and this section:
    ```
    The check "<failed step name>" failed in round <r - 1>:
    <failure text>

    Earlier attempts:
    - round 1: <summary>
    Fix the problem.
    ```
    The `Earlier attempts` block has one line per earlier round, including the round that just failed: `- round N: <first line of the last agent step's text in that round, at most 160 characters> -> <failed step name> failed`. Call `deps.runAgent(step, taskText, signal, onLine)`; each `onLine` call emits `{ type: "line", stepId, text }`. Passed when `ok` is true; text is the first 600 characters of the agent's text.
  - Command step: `program = command[0]`, the rest are arguments, each run through `fillPlaceholders`. Run with `deps.exec(program, args, { cwd: workspace, timeoutMs: (timeoutSec ?? 120) * 1000, signal })`. It FAILS when: `notFound` (text `The program "<program>" is not installed on this machine.`), `timedOut` (text `Timed out after <n> s.`), exit code is not 0, or any output line contains FAIL, FAILED, ERROR or MISMATCH as a whole word (case-insensitive). Output lines = stdout then stderr, non-empty, each trimmed to 200 characters. Result text: on failure, up to 10 failure lines (or, when there are none, the last 10 lines), then `(<m> more lines not shown)` if lines were left out; on success, the last 5 lines, or `Finished with no output.`.
  - Record `StepRun { stepId, status, round, text, ms }`, emit state.
  - Passed: if `pause` is true and it is not the last step, status becomes `paused`, `current` = next step id, log `Paused after step <n>, <name>.`, emit, stop the loop. Otherwise go to the next step. After the last step: status `done`, `current` null, log `Round <r>: all steps passed.`.
  - Failed: if the step has `onFail`, the target exists at or before this step, and `round < onFail.maxRounds`: log `Round <r>: step <n>, <name>, failed. Going back to step <m>, <target name>.`, remember the failure (step name and result text), `round += 1`, continue from the target step. Steps from the target onward that are not `once`-kept go back to `waiting` (keep `passed` ones that will be `kept`). Otherwise: status `failed`, `current` stays on the failed step, log `Round <r>: step <n>, <name>, failed. Stopped and waiting for you.`.
- `stop()`: abort the signal given to exec/runAgent, status `stopped`, log `Stopped by you.`. A step that was running goes back to `waiting`. Results that arrive after a stop are ignored.
- `resume(fromStepId?)`: only when status is `paused`, `failed` or `stopped`. Continue from `fromStepId` if given and valid, else from `current`. Status `running`. The round number is unchanged and no failure section is appended (the user took over). Uses a fresh AbortController.
- `state` is always a fresh deep copy when read and in every event, so callers cannot mutate the run. `steps` has one `StepRun` per workflow step, in order, from the moment `start()` is called (before that: empty array, status `idle`, round 0, current null).
- `events` holds every event emitted so far. `subscribe` returns an unsubscribe function. A throwing listener must not break the run.
- Never throw out of the loop: an exception from exec or runAgent makes that step `failed` with the error message as text.

## Default workflow file

`workflows/fpga-block.json`, a `Workflow`:
- id `fpga-block`, name `Verilog block: write, simulate, check`, task `Describe the block to build, or name the spec file.`
- vars `{ "design": "rtl/design.v", "tb": "tb/tb_design.v" }`
- steps:
  1. id `write`, agent step, agent `fpga`, name `Write the design`, task `{task}\n\nWrite the design in {design}. Compile it and fix every error. Do not write a testbench.`
  2. id `compile`, command step, name `Compile`, command `["iverilog", "-g2012", "-o", ".build/design.out", "{design}"]`, onFail `{ goTo: "write", maxRounds: 3 }`
  3. id `testbench`, agent step, agent `fpga`, name `Write the testbench`, `once: true`, `pause: true`, task `{task}\n\nWrite a self-checking testbench in {tb} for the module in {design}. Read only its port list. Print one line starting with PASS or FAIL for each check and call $finish at the end. Do not change {design}.`
  4. id `build`, command step, name `Build the simulation`, command `["iverilog", "-g2012", "-o", ".build/sim.out", "{design}", "{tb}"]`, onFail `{ goTo: "write", maxRounds: 3 }`
  5. id `simulate`, command step, name `Simulate`, command `["vvp", ".build/sim.out"]`, onFail `{ goTo: "write", maxRounds: 3 }`

## Tests (`test/workflow.test.ts`)

Use a fake `exec` and a fake `runAgent` scripted per test; no real programs. Wait for the run to settle by subscribing and resolving a promise when the status leaves `running`. Cover at least: placeholders; every validation problem; a straight pass; a command failing on exit code, on a FAIL line, on not-installed, on timeout; whole-word matching (`0 errors` and `bypass` are not failures); loop back with round increment, the failure section and attempts in the next agent task, and reaching `maxRounds` -> `failed`; `once` step kept in round 2; pause and resume; resume from a chosen step after failure; stop during a running step (late result ignored, step back to waiting); invalid workflow -> failed with problems in the log; state objects are copies; a throwing listener does not break the run; the shipped `workflows/fpga-block.json` passes `validateWorkflow`.

## Verify

- `npx vitest run test/workflow.test.ts` passes.
- `npx tsc --noEmit` shows no errors in your files (errors elsewhere belong to others: ignore, but mention them).
