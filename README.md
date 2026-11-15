# Agent Bench

Agent Bench is a light harness that lets local language models do hardware coding for FPGA, DPU and GPU projects. It runs agents and workflows through an OpenAI-compatible model server and records their tool calls. A browser app provides Work, Workflows, Trace, Agents and an optional Results screen for the owner's Lab tests.

Folder layout:

- `src/`: engine, command-line tools, local HTTP server and shared types.
- `web/`: React browser app.
- `agents/`, `workflows/`: agent definitions, agent skills and workflow files.
- `tasks/`, `evals/`, `scripts/`: task prompts and scoring commands.
- `runs/`: traces and scored results in `results.jsonl`.
- `test/`, `examples/`, `docs/`: tests, code examples and documentation.

Quick start on one machine: use Node 22.19 or newer, iverilog with vvp, and a running OpenAI-compatible model server. Run these commands from the repository root:

```bash
npm install
```
```bash
npm run web:install
```
```bash
npm run web:build
```

Set the server URL, exact model ID and compile/simulate command paths in `config.local.json`; it overrides `config.json`. See the small example in [server instructions](docs/server.md).

```bash
npm run app -- --folder <absolute-project-path>
```

Open http://localhost:4600. This is development mode, started by hand, with no service installed.

Agents live in `agents/<name>/agent.json` and `prompt.md`. Skills are Markdown files in `agents/<name>/skills/`. Workflows are JSON files in `workflows/`; they can also be edited in the browser. Turn off Lab tools to hide the owner's Results tab.

Read [PLAN.md](PLAN.md) for the design and progress, [docs/server.md](docs/server.md) for the office server and scoring commands, and [examples/](examples/) for code usage.

## Scoring tasks

The tuning set contains `gain`, `counter`, and `fir4`. The held-out set contains `pwm`, `seqdet`, `regbank`, `fifo`, `accum`, and `uart_tx`. Tune skills and hints only on the tuning set; the held-out set is only measured. Run either set with `bash scripts/eval_set.sh <tuning|heldout>`, followed by the usual `eval_local.sh` options.

## External VerilogEval

Run specification-to-RTL VerilogEval v2 with `bash scripts/verilog_eval.sh dev -n 2 -s local-fast -t 90`. The external benchmark must be cloned first. See [setup, split policy, judging and failure reports](evals-external/README.md). Tune only on dev; measure heldout without reading its failures to adjust skills.
Run the bare model with `bash scripts/verilog_eval_raw.sh dev -s local-fast`; see [the repeatable PC and office server procedure](docs/verilog-eval.md).
Compare saved runs with `node scripts/verilog_eval_report.mjs --compare <harness folder> <raw folder>`.
## RTL quality gate

Run `npm run quality -- design.v` for a model-free RTL check. Findings include line numbers; notes do not fail the gate. The final line is `QUALITY PASS` or `QUALITY FAIL`, with exit code 1 for failures. Optional `commands.lint` (Verilator) and `commands.synth` (Yosys) arrays in config enable external checks when installed; the configured Icarus compiler also runs with `-Wall`. The tools line lists checks that ran. Eval runs record `quality` and `qualityFindings` separately from the functional verdict; `bash scripts/check_evals.sh` checks every reference.

