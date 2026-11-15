# VerilogEval: raw model against the harness

Run these from the repository root with Bash, Node 24, installed project dependencies, and Icarus (`iverilog` and `vvp`) on PATH or configured in `config.local.json`. Start the model server first. Use the same model and server settings for each pair of runs. Run one scoring job at a time.

The raw test:

- Sends one streamed chat request per problem, with no tools, skills, hints, feedback or retry.
- Extracts the answer using the benchmark's rules and judges it against the hidden test.

The harness test:

- Gives the agent the same specification in `spec.md` and asks it to write `rtl/TopModule.sv`, compile it and fix errors.
- Allows the agent's tools and uses the same hidden test and judge flags for the final file. Quality findings are recorded separately.

The raw system message is exactly this JSON string (including the leading and trailing newlines):

```json
"\nYou are a Verilog RTL designer that only writes code using correct Verilog syntax.\n"
```

The raw user message is `"\nQuestion:\n"`, then the problem text with newlines normalized to LF (as Python text mode does) and outer whitespace removed, then exactly this added text:

```json
"\n\nEnclose your code with [BEGIN] and [DONE]. Only output the code snippet\nand do NOT output anything else.\n\nAnswer:\n"
```

These come from `external/verilog-eval/scripts/sv-generate`, `prompts['spec-to-rtl']`, `prompt_no_explain_suffix`, and the `spec-to-rtl` prompt assembly. Defaults mean zero examples, no extra rules, no explanation. Marker extraction takes priority; otherwise the first fenced block or the benchmark's plain-module fallback is used. An unclosed `[BEGIN]` gives no code. No code is repaired. Sampling settings come from the configured server, rather than upstream's hosted-model defaults.

Results live in `runs/verilog-eval-raw/<timestamp>/<problem>/` and `runs/verilog-eval/<timestamp>/<problem>/`; repetitions add `run-N/`. Raw attempts save `request.json`, `reply.txt`, `reply.json` (including reasoning), extracted `TopModule.sv` when present, `result.json`, and `judge/` logs. Both runners append to `runs/results.jsonl` and print their folder as the last line. Exit 0 means all passed; 1 means at least one failed; 2 means the run could not finish.

The comparison pairs each problem and attempt, showing verdicts and elapsed seconds including judging. A dash means missing. Totals count attempts; the three pass lists count problems with at least one pass. A note names different problem coverage, models or servers. Comparisons work on held-out results without `--all`; tune only on dev.

Run the following in order. `<model id>` means the exact ID LM Studio shows; quote it if it contains spaces. Replace `<harness folder>` and `<raw folder>` with the last lines printed by the corresponding runs. Setup commands are identical on both machines.

1. Clone and pin the benchmark. This PC:

```bash
git clone https://github.com/NVlabs/verilog-eval external/verilog-eval
```

```bash
git -C external/verilog-eval checkout c498220d0a52248f8e3fdffe279075215bde2da6
```

Office server:

```bash
git clone https://github.com/NVlabs/verilog-eval external/verilog-eval
```

```bash
git -C external/verilog-eval checkout c498220d0a52248f8e3fdffe279075215bde2da6
```

2. Write the split. This PC:

```bash
node scripts/verilog_eval_report.mjs --write-split
```

Office server:

```bash
node scripts/verilog_eval_report.mjs --write-split
```

3. Raw dev run. This PC:

```bash
bash scripts/verilog_eval_raw.sh dev -s local-fast
```

Office server:

```bash
bash scripts/verilog_eval_raw.sh dev -s office -m "<model id>"
```

4. Harness dev run. This PC:

```bash
bash scripts/verilog_eval.sh dev -s local-fast
```

Office server:

```bash
bash scripts/verilog_eval.sh dev -s office -m "<model id>"
```

5. Compare dev folders. This PC:

```bash
node scripts/verilog_eval_report.mjs --compare "<harness folder>" "<raw folder>"
```

Office server:

```bash
node scripts/verilog_eval_report.mjs --compare "<harness folder>" "<raw folder>"
```

6. Raw held-out run. This PC:

```bash
bash scripts/verilog_eval_raw.sh heldout -s local-fast
```

Office server:

```bash
bash scripts/verilog_eval_raw.sh heldout -s office -m "<model id>"
```

7. Harness held-out run. This PC:

```bash
bash scripts/verilog_eval.sh heldout -s local-fast
```

Office server:

```bash
bash scripts/verilog_eval.sh heldout -s office -m "<model id>"
```

8. Compare held-out folders. This PC:

```bash
node scripts/verilog_eval_report.mjs --compare "<harness folder>" "<raw folder>"
```

Office server:

```bash
node scripts/verilog_eval_report.mjs --compare "<harness folder>" "<raw folder>"
```

Both runners accept `-n` (problem limit), `-r` (independent repetitions, default 1), `-t` (seconds per reply/run, default 120), `-s` (server, default `local`) and `-m` (model override). Selection can also be `all` or a file of problem names. Check extraction plus judging without model calls with `node scripts/verilog_eval_raw.mjs --check-references`.
