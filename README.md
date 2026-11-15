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
