# Task O: topic skills from the old harness, and preloading skills per step or per run

You are the only task running. You may edit `src/shared/api.ts`. Do not edit `agents/fpga/prompt.md`, `agents/fpga/skills/verilog-rules.md`, `agents/fpga/skills/fixed-point.md`, `PLAN.md`.

Why: the owner's old harness has longer, more descriptive FPGA skills. We want them available as topic skills that are loaded only when relevant, and a way to preload chosen skills so two skill sets (and two comment policies) can be scored against each other.

## Part 1: preload skills (src/shared/api.ts, src/skills.ts, src/workflow.ts, src/agent.ts or wherever the system prompt is built, src/engine.ts, src/cli.ts, src/cli-workflow.ts, src/index.ts, scripts/eval_local.sh)

- `AgentStep.skills?: string[]`: skill names of the step's agent that are placed in the system prompt for this step, exactly as an always-on skill is. Also allowed inside `retry`.
- Command line: `--skills a,b` on `npm run agent` and on `npm run workflow` (for the workflow it is added to every agent step). Code API: the matching option.
- `scripts/eval_local.sh -k a,b` passes `--skills a,b`, and the recorded `--setup` text gets ` +a,b` appended so results can be told apart.
- An unknown skill name is an error before the run starts, naming the skill and the agent.
- A preloaded skill is not offered again by `use_skill` and is not loaded twice.
- The prompt size recorded in the trace includes preloaded skills.
- The Workflows screen must not drop the new field when saving. Check; fix only if it does.

## Part 2: topic skills (new files only, under `agents/fpga/skills/` and `agents/testbench/skills/`)

Source to read: `C:\Users\siddh\Documents\Personal\DUMP\ai_demo\harness\skills\fpga-rtl-design\` (`SKILL.md`, `arithmetic.md`, `testbench.md`). Read nothing else in that repository; never open its `harness/judge` folder.

Write these, each with the same front matter as the existing skills (`name`, `description`, `always: false`), at most 2,600 characters each, plain Verilog-2001:

- `agents/fpga/skills/signed-arithmetic.md`: the signedness rules (what is unsigned by definition, one unsigned operand makes the whole expression unsigned, context-determined width), the good and bad one-line examples, Q-format bookkeeping, the "common bugs" list. Do not repeat what `fixed-point.md` already says.
- `agents/fpga/skills/pipelining.md`: latency, stage naming, delaying `valid` with the data. Start with: decide the latency from the spec first; add a register stage only when the spec allows that latency.
- `agents/fpga/skills/reset-and-state.md`: synchronous and asynchronous reset forms, what to reset, FSM with `case` and `default`, one driver per signal.
- `agents/fpga/skills/bus-registers.md`: handshake exactly as specified, full address decode, read-back with sign extension, write-then-read test.
- `agents/fpga/skills/plan-first.md`: the "before writing code" checklist as an instruction: before the first write, state in at most six short lines the ports with width and sign, the latency in clocks, the reset, the overflow behaviour, and rounding or truncation; then write the file.
- `agents/fpga/skills/style-no-comments.md`: "Write Verilog without comments. Use clear signal names instead."
- `agents/fpga/skills/style-header-comment.md`: "Write one comment block at the top of the module stating latency and number formats. No other comments."
- `agents/testbench/skills/testbench-template.md`: the self-checking template and checklist from `testbench.md`, printing `PASS <name>` or `FAIL <name> got %0d wanted %0d` per check and a final `ALL TESTS PASSED` or `<n> TESTS FAILED`.

Rules for the text:
- The `description` says precisely when to load the skill, in one line; a small model chooses from these lines.
- Advice that is right only under a condition states the condition first.
- No sources list, no SystemVerilog section, no checkbox syntax.
- Every code block must compile with Icarus (`C:/iverilog/bin/iverilog.exe`): wrap each in a module in a scratch folder outside the repository tree if you can, otherwise under `.build/` and delete it afterwards. Say in the report that you did.

## Tests

- Preload: skill text is in the system prompt; not offered by `use_skill`; unknown name fails early; retry skills used on the second round only; prompt size includes it.
- A test that every skill file under `agents/` has valid front matter and is at most 2,600 characters, except `verilog-rules.md` and `fixed-point.md`.

Finish with `npx.cmd tsc --noEmit` (root and `web/`) and `npx.cmd vitest run`.
