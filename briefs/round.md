# Improvement round (reusable brief)

You run one full improvement round by yourself: measure, read the failures, make general fixes, test, measure again, report. Read `briefs/common.md` and the "Accuracy" and "Next steps" parts of `PLAN.md` first.

Goal (owner's words): "produce correct, industry level, speed, fpga code workflow using this tool for local models by repetitive improvement". Correct RTL is the measure; the testbench matters little when the RTL is right.

## Hard rules

- Tune only on: the VerilogEval `dev` split, our tuning tasks (`gain`, `counter`, `fir4`), and the old harness's easy task. Never read failures of `heldout` splits or of our held-out tasks (`pwm`, `seqdet`, `regbank`, `fifo`, `accum`, `uart_tx`) to change anything.
- Never open `harness/judge` in the old harness (`<ai_demo>`). The verdict lines the script prints and the agent traces under `runs/*/agent_bench` are fine.
- Fixes must be general: a rule of Verilog or of good RTL practice, a deterministic check, a hint, a tool behaviour. No text that names or fits one problem. If a fix would only help one problem, do not make it.
- Prefer a deterministic check or hint in code over more prompt text. Keep the always-on prompt and skills short; say in the report how many characters you added.
- Do not use git. Do not edit `PLAN.md`. Do not push or install anything.
- The local model (Ollama at `http://localhost:11434`, servers `local-fast` = thinking off, `local` = thinking on) is shared: run one scoring command at a time, never two in parallel.
- Do not let a single model run exceed its time limit options; use the defaults in the commands below.

## Steps

1. Baseline. Unless the invoking message gives you the baseline numbers, run:
   - `bash scripts/verilog_eval.sh dev -s local-fast -t 120`
   Icarus is at `C:/iverilog/bin` (add it to PATH for the command).
2. Read the failures: `node scripts/verilog_eval_report.mjs runs/verilog-eval/<latest>` and, for each failed dev problem, the spec, the model's file and the trace. Group them by cause. For every group ask: could a check, a hint or one rule line have prevented it for any design of that kind?
3. Make at most four fixes, the ones that cover the most failures. Add tests for code changes. Run `npx.cmd tsc --noEmit` (root and `web/`), `npx.cmd vitest run`, `bash scripts/check_evals.sh`. The nine reference designs must stay free of hints and pass the quality gate.
4. Measure again with the same command as the baseline. Then run the regression check: `bash scripts/eval_set.sh tuning -n 2 -s local -w workflows/fpga-fast.json -t 150`.
5. If the invoking message asks for it, also run the old harness's easy task: `bash scripts/h_task.sh <path to ai_demo> easy local-fast -n 3 -t 300`, read the three agent traces, and include what you see.
6. Write the report to `docs/rounds/<date>-<n>.md` (create the folder; plain Markdown, under 80 lines) and print the same text as your final message:
   - numbers before and after (passed of total, median seconds, counts per verdict), and the tuning-set result;
   - the failure groups with counts;
   - each fix: what, why it is general, files changed, characters added to prompt or skills;
   - what got worse, if anything, named plainly;
   - the three failure groups you did not fix and what would be needed;
   - any change you are unsure about, so it can be reverted.

If the second measurement is lower than the baseline by more than three problems, say so at the top of the report and name the change you suspect.
