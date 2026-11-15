# Task Y: raw VerilogEval run, to compare the bare model with the harness

You are the only task running. Files you may touch: new `scripts/verilog_eval_raw.sh`, new `scripts/verilog_eval_raw.mjs`, `scripts/verilog_eval_report.mjs` (only to share the judge and add `--compare`; move shared code into a new `scripts/lib/` module if that is cleaner), `evals-external/README.md`, `README.md` (two lines), tests for the new code. Do not edit `agents/`, `src/`, `workflows/`, `PLAN.md`.

Why (owner, 2026-11-15): "Add a raw verilogeval test, I want to compare with the harness result and raw LLM results." We need the same model's score on the same problems with no harness at all: one request, one answer, straight to the judge.

## The raw runner

`bash scripts/verilog_eval_raw.sh <dev|heldout|all|file with problem names> [-n max problems] [-s server] [-m model] [-r runs per problem, default 1] [-t seconds per problem, default 120]`

For each problem, exactly one chat request and nothing else:
- No tools, no agent prompt, no skills, no hints, no compile feedback, no retry.
- Messages follow VerilogEval's own zero-shot specification-to-RTL flow. Read (do not run) the generation script in `external/verilog-eval/scripts/` to find its system message, the text it appends to the problem prompt, and how it extracts the code from the reply, and reproduce those three things. Record in `evals-external/README.md` exactly what you took from where. If the benchmark's flow has options, use its default zero-shot setting with no in-context examples.
- The request goes to the server named by `-s`, read from `config.json` merged with `config.local.json` exactly as the harness does: same base URL, model, temperature and `extra` fields. So `local-fast` is thinking off and `local` is thinking on, as in the harness runs. Use a streamed request like `src/model.ts` does, so slow replies do not hit Node's header timeout. A reply that does not arrive within `-t` seconds is verdict `TIME`.
- Save the full reply, the extracted code as `TopModule.sv`, and the judge output under `runs/verilog-eval-raw/<timestamp>/<problem>/` (`run-N/` for repetitions).
- Judge with the same code and flags as the harness runner. Verdicts: `PASS`, `MISMATCH`, `COMPILE_ERROR`, `NO_CODE` (nothing extractable), `TIME`, `JUDGE_ERROR`.
- Record each result with the existing recorder: suite `verilog-eval`, level = the split, setup `raw`, the problem name in `task`.
- Print one line per problem and the same summary lines as the harness runner (passed of total, pass rate, median and mean seconds, counts per verdict).

## The comparison

`node scripts/verilog_eval_report.mjs --compare <harness run folder> <raw run folder>` prints:
- a table: problem, harness verdict and seconds, raw verdict and seconds;
- totals for both: passed of total, pass rate, median seconds;
- three lists: passed by both, passed only with the harness, passed only raw;
- a one-line note when the two folders do not cover the same problems or the same model or server, naming the difference.
It works on any split (this is a comparison of results, not a reading of failures, so the `--all` guard does not apply to it).

## Checks

- Unit tests with small fixtures: code extraction (fenced block, the benchmark's own markers if it uses them, plain module text, nothing), the compare table and its lists, the mismatch note.
- Smoke test only if `http://localhost:11434` answers and no other scoring run is using it: two dev problems with `-s local-fast`. Do not run more; say what happened.
- Feeding the benchmark's reference text through the extraction and the judge passes for three problems.

Finish with `npx.cmd tsc --noEmit` and `npx.cmd vitest run`. Report what you created, the test results, and the exact prompt text used.

## Saved for the owner to see and to run on the server (added 2026-11-15)

The owner wants the raw test kept as a saved, repeatable procedure that he can read and run on the office server too. You may also edit `docs/server.md` and add `docs/verilog-eval.md` for this.

- `docs/verilog-eval.md`: one page, plain words. What the raw test is and what the harness test is, in two short lists; the exact messages the raw test sends (system message and the added text, quoted); where results are kept; how to read the comparison table. Then the commands, one per code block, in the order to run them on any machine:
  1. clone the benchmark into `external/verilog-eval` and check out the recorded commit;
  2. write the split (`node scripts/verilog_eval_report.mjs --write-split`);
  3. raw run on the dev set;
  4. harness run on the dev set;
  5. the comparison of the two folders;
  6. the same three for the held-out set.
  Give each command twice: for this PC (`-s local-fast`) and for the office server (`-s office -m <model id>`), where the model id is the one LM Studio shows.
- `docs/server.md`: add a short section "VerilogEval: raw model against the harness" that points to that page and lists what the server needs first (the clone, Icarus on PATH, `config.local.json`). Note that thinking on or off is set per server entry in `config.json` through `extra`, and that LM Studio may ignore `reasoning_effort`; say how to see in a trace whether the model thought (the `reasoning` field of a response).
- Both runners print, as their last line, the folder they wrote, so the comparison command can be copied.
