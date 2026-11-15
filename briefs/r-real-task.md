# Task R: four fixes from the old harness's easy task

You are the only task running. You may edit `src/shared/api.ts`. Do not edit `agents/`, `workflows/`, `evals/`, `PLAN.md`.

Why: the old harness's easy task (design with a register bus, plus a testbench the model must write itself, 300 s) scored 0 of 4 on the small local model. The traces showed four general problems. None of the fixes may mention that task.

## 1. Code in the reply, nothing saved (src/agent.ts, src/session.ts)

One run ended after two tool calls: the model put the whole Verilog file in its reply text with no `@tool` block, which the harness reads as the final answer. Nothing was written.

When a reply has no tool call, and the run has had no successful `write_file` or `replace_lines` so far, and the reply contains a fenced code block or a line starting with `module ` followed later by `endmodule`: do not end the run. Send one user message:

`You put code in your reply, but nothing is saved. Save it with write_file, then test it.`

Only once per run; a second such reply ends the run as before. Count it in the trace (a `guard` row with a clear reason) so it shows on the Trace screen. Sub-agents get the same behaviour. The interactive session gets it too, but only when the agent has write tools.

## 2. Minus sign inside a sized constant (src/tools/compile.ts, src/tools/write_file.ts, src/tools/replace_lines.ts, new src/tools/autofix.ts)

`14'sd-8192` appeared in 3 of 4 runs and each time cost a full rewrite. Also the current hint recommends `-16'sd32768`, which is wrong in a wider expression (the literal is sign-extended first, then negated). Change both:

- Hint text becomes: `Hint: a sized constant cannot contain a minus sign. Write the value as a plain signed decimal, for example -8192.`
- Automatic repair on write, for files ending in `.v`, `.sv`, `.vh`, `.svh`: in the text being written, replace every decimal constant of the form `<size>'[sS]?[dD]-<digits>` (optional spaces around the minus) with `-<digits>`. Do not touch text inside `//` comments, `/* */` comments or string literals. When at least one was replaced, the tool result adds one line: `Fixed <n> constant(s): 14'sd-8192 -> -8192 (a sized constant cannot contain a minus sign).` showing the first one. In an interactive session the proposal and its diff show the repaired text.
- Put the repair in `src/tools/autofix.ts` as `autofixVerilog(text): { text: string; notes: string[] }` so later repairs have a home. Nothing else is repaired now.

## 3. Rewriting a long file for a one-line error (src/tools/compile.ts, src/tools/run_sim.ts)

The model rewrote an 11,000-character testbench five times (about 40 s each) to fix single syntax errors. When a compile fails and an error is reported in a file that has more lines than the whole-file limit (`smallFileLines`, 150 by default; read how `edit_policy.ts` gets it), append once per result:

`Hint: <file> has <n> lines. Fix only the reported lines with replace_lines; do not rewrite the file.`

This hint counts toward the existing cap on hint lines but has the lowest priority.

## 4. A different task text on a retry, and workflows for the old-harness script (src/shared/api.ts, src/workflow.ts, scripts/h_task.sh)

- `AgentStep.retry.task?: string`: when present, it replaces the step's `task` on later rounds. Placeholders are filled the same way and the failure report and earlier attempts are appended as now. Validate it is not blank when given. The Workflows screen must not drop it.
- `scripts/h_task.sh`: new option `-w <workflow.json>`. With it, the run uses `src/cli-workflow.ts` with `--no-pause`, the same task file as `--task`, `--max-seconds` as now, the same `--protect` list, and `--var design=<the module path the script already knows>` and `--var tb=<the testbench path named in the task file for that level>`. The recorded `--setup` becomes `workflow <name>`. Without `-w` nothing changes. Read the script first and keep its judge, leak check and verdict logic untouched. Do not open the old harness's `harness/judge` folder.

## Tests

- Reminder: fires once, not after a successful write, not for a plain-text final answer, second time ends the run; trace row present.
- Autofix: the cases above, comments and strings untouched, hex constants untouched, `replace_lines` path, the note text, the session proposal carries the repaired text.
- Long-file hint: present above the limit, absent at or below it.
- `retry.task`: used on round two only, placeholders filled, report appended; validation.

Finish with `npx.cmd tsc --noEmit` (root and `web/`) and `npx.cmd vitest run`.
