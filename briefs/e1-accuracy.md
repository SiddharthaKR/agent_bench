# Task E1: make a small local model accurate at Verilog work

Read `briefs/common.md` first and follow it, with this change to its file rule: in this task you OWN and may edit `src/agent.ts`, `src/session.ts`, `src/guard.ts`, `src/protocol.ts`, `src/tools/**`, `agents/**`, `scripts/**`, and their tests, and you may create `src/skills.ts`, `src/context.ts`, `src/cli-workflow.ts`, `evals/**`. You may add scripts to the root `package.json` `scripts` block only. Do NOT touch `src/server/**`, `src/shared/**`, `src/engine.ts`, `src/model.ts`, `src/workflow.ts`, `web/**`.

## Why

A 4B-class local model (Gemma 4 E4B on Ollama) was run on small Verilog tasks with this harness. Tool calls arrive intact, but it fails the tasks. What the traces showed:

1. It kept calling `replace_lines` on a line range that was stale after its own earlier edit. The file grew from 45 to 225 lines of broken code.
2. The same compile failure came back many times in a row; it never stepped back and rewrote the file.
3. Context grew from 0.5k to 15-28k tokens in 40 calls, mostly old tool output and old file text.
4. It makes basic Verilog mistakes (declarations inside always blocks, wrong signed saturation, unsized constants).

Fix these in the harness. Every change must be general: nothing may be tuned to a particular task or test.

## 1. Skills (`src/skills.ts`)

- A skill is a Markdown file `agents/<agent>/skills/<name>.md` with a front-matter block: `name`, `description` (one line), `always` (`true` or `false`).
- `agent.json` may have `"skills": ["name", ...]`. Absent means every skill file in the folder is enabled.
- `loadSkills(agentDir, enabled?)` returns `{ name, description, always, text }[]` (text without front matter). Missing folder -> empty list. A file without valid front matter is skipped.
- In `loadAgent` (src/agent.ts): the text of each `always` skill is appended to the system prompt after the agent prompt, each under a line `## <name>`. Other skills are listed after the tool help as `Skills you can load with use_skill:` and one `- name: description` line each.
- A new tool `use_skill` (arg `name`, required) returns that skill's text, or an error naming the available skills. It is added automatically only when the agent has at least one non-always skill. It does not count as an edit and needs no approval.
- Write two skills for the `fpga` agent, in your own words, general engineering practice only:
  - `verilog-rules.md`, `always: true`, AT MOST 220 words. The rules a small model most often breaks in synthesizable Verilog-2001 with Icarus Verilog: declare every wire/reg at module level, never inside `always`; non-blocking `<=` in clocked blocks, blocking `=` in combinational ones; size and sign every constant (`16'sd5`), declare signed operands `signed` on both sides; widen before multiply or add, then saturate by comparing the wide value against the limits and assigning the limit, never by slicing; one driver per reg; `localparam` for constants; testbench style: `$display("PASS name")` / `$display("FAIL name ...")` per check and `$finish` at the end.
  - `fixed-point.md`, `always: false`, at most 350 words: bit growth for multiply and add, arithmetic shift and rounding (round half up by adding half before the shift), saturation limits for signed N bits, a short worked saturating multiply-shift example, and how to sign-extend on read-back.
- If `<ai_demo>/harness/skills/fpga-rtl-design/SKILL.md` is readable, use it as a source for facts, but write new, shorter text.

## 2. Small files are rewritten whole

- `agent.json` may have `"smallFileLines"` (default 150; 0 disables).
- `replace_lines` on a file with at most that many lines is refused before it runs with: `<path> has <n> lines. For a file this small, read it and rewrite the whole file with write_file.` Implement it where it applies to both `runAgent` and the interactive session (one shared helper), before the approval step, so the user is never asked to approve a refused edit.
- Update `agents/fpga/prompt.md` to say the same in one line. Keep the prompt short (at most 90 words) and plain.

## 3. Notice a result that does not change (`src/guard.ts` plus wiring)

- Track the result text of the check tools. Which tools are checks is a guard option (`checkTools`, default `["compile", "run_sim"]`). Do not edit `src/types.ts`.
- When the same check tool fails with exactly the same text as its previous 2 results (3 in a row, with any other calls between), append this hint to the result the model sees: `Same result 3 times. Your edits are not fixing it. Read the whole file, then rewrite it completely with write_file.` Append it again on every further identical result.
- Expose it as a method on `LoopGuard` (for example `noteResult(call, ok, text): string | undefined` returning the hint) and use pi-agent-core's `afterToolCall` hook in both `runAgent` and the session to append the hint to the tool result content. Read `node_modules/@earendil-works/pi-agent-core/dist/types.d.ts` (`AfterToolCallContext`, `AfterToolCallResult`) for the exact shape.

## 4. Context trimming (`src/context.ts`)

- `trimContext(messages, options?)`: a pure function over pi `AgentMessage[]` used as the Agent's `transformContext` in both `runAgent` and the session. Options: `keepRecent` (default 6 messages), `maxOldResultChars` (default 300).
- The last `keepRecent` messages are never changed. The first user message (the task) is never changed. System messages are never changed.
- In older messages:
  - a `toolResult` whose text is longer than `maxOldResultChars` becomes its first 3 lines plus a line `(older output trimmed)`;
  - an assistant `toolCall` whose `arguments.content` is a string longer than 400 characters gets `content` replaced by `(file text omitted; the current file is on disk)`.
- Never remove a message, never change roles, ids or order, never mutate the input (return new objects for changed messages only).
- `agent.json` may have `"trimContext": false` to turn it off (default on).

## 5. Compile feedback

- In `src/tools/compile.ts`, when a failure message line matches a known pattern, add ONE short hint line after the source line. Keep a small table, general Icarus Verilog knowledge only, for example: `syntax error` on a line containing `reg ` or `wire ` that lies inside an always block -> `Hint: declare wires and regs at module level, not inside always.`; `is not a valid l-value` -> `Hint: only a reg can be assigned in an always block; a wire needs assign.`; `Unable to bind wire/reg/memory` -> `Hint: this name is not declared in this module.`; `Syntax in assignment statement l-value` -> `Hint: check the line above for a missing semicolon or end.` At most 2 hints per result.

## 6. Run a workflow from the command line (`src/cli-workflow.ts`)

- `npm run workflow -- --workflow <file.json> --folder <project> --task "<text>" [--server local] [--model id] [--var name=value ...]`
- Loads the workflow JSON, applies `--var` overrides to `vars`, builds deps exactly like `src/engine.ts` does for `createWorkflowRun` (read that file; reuse `loadConfig`, `runAgent`, `createWorkflowRun`, `realExec`), prints each state change as one line (`round 1 · step 2 Compile · passed`) and each agent line indented, auto-continues past pauses when `--no-pause` is given (otherwise stops at a pause and says how to continue), and exits 0 only when the run status is `done`.

## 7. Local scoring (`evals/` and `scripts/eval_local.sh`)

- `evals/gain/`: `spec.md` and `tb/tb_gain.v` copied from `<a scratch demo folder>` (if you cannot read that folder, say so and stop this item), plus `task.md` with: `Read spec.md and write rtl/gain.v. Then run run_sim with files: rtl/gain.v tb/tb_gain.v and fix the design until every test passes.`
- `scripts/eval_local.sh [-n runs] [-s server] [-m model] [-w workflow.json]`: for each run, copy `evals/gain` to a fresh temp folder, run the agent (`npx tsx src/cli.ts`) or, with `-w`, the workflow CLI with `--no-pause --var design=rtl/gain.v --var tb=tb/tb_gain.v`, then INDEPENDENTLY compile and simulate `rtl/gain.v` with `tb/tb_gain.v` (programs from `config.local.json`/`config.json` `commands`, falling back to `iverilog`/`vvp` on PATH; a tiny `node` one-liner may read the JSON) and count the run as passed only if the output contains `ALL TESTS PASSED`. Print one line per run (`run 3: PASS, 12 tool calls, 41 s`) and a final `PASSED k of n`. Bash, LF line endings, works in Git Bash on Windows and on Linux.

## 8. A time limit per run

The owner does not want a local model to grind on an easy task for a long time: a decent time must be enough, and after that the run ends and can be retried.

- `runAgent` gets an option `maxSeconds` (and `agent.json` an optional `"maxSeconds"`; the option wins; absent = no limit). When the time is up the run is aborted and ends with reason `time` (add it to `EndReason`), with `error` unset and the final text kept if there is one. The timer must be cleared when the run ends by itself.
- `src/cli.ts`: `--max-seconds <n>`. The summary line says `Ended: time (limit <n> s)`.
- `src/cli-workflow.ts`: `--max-seconds <n>` applies to each agent step.
- `scripts/eval_local.sh`: `-t <seconds>` per run, default 300, passed as `--max-seconds`. A run that hits the limit counts as failed and its line says `TIME`. Print the total elapsed time at the end.
- Set `"maxSeconds": 600` in `agents/fpga/agent.json` as the default for interactive use.

## Tests

Add or extend vitest tests for every item (the time limit with a fake model that never finishes): skills loading and prompt assembly, `use_skill`, the small-file refusal (agent and session), the repeated-result hint, `trimContext` (purity, each rule, pairs kept), compile hints, workflow CLI argument parsing (factor parsing into a pure exported function). Existing tests must keep passing; update expectations that legitimately change and say which.

## Verify

- `npx vitest run` passes completely.
- `npx tsc --noEmit` is clean.
- `bash -n scripts/eval_local.sh` is clean. Do not run the eval itself (it needs a model server).
