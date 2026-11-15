# Task J: results (Lab), the medium task, and running on the office server in development mode

Read `briefs/common.md` first and follow it, with this change to its file rule: in this task you OWN and may edit `src/server/**` (including `main.ts`), `web/src/App.tsx`, `web/src/api.ts`, `scripts/**`, `tasks/**`, and you create `src/shared/results.ts`, `src/results.ts`, `src/cli-result.ts`, `web/src/results/**`, `docs/server.md`, `README.md`, and tests. You may add scripts to the root `package.json` `scripts` block only. Do NOT touch `src/agent.ts`, `src/session.ts`, `src/engine.ts`, `src/workflow.ts`, `src/model.ts`, `src/tools/**`, `src/shared/api.ts`, `src/shared/engine.ts`, `src/agent-store.ts`, `agents/**`, `web/src/work/**`, `web/src/workflows/**`, `web/src/trace/**`, `web/src/agents/**`, `web/src/theme.css`.

Read first: `scripts/h_easy.sh`, `scripts/eval_local.sh`, `tasks/h-easy.md`, `src/server/http.ts`, `src/server/main.ts`, `web/src/App.tsx`, `PLAN.md`.

## 1. Results are recorded

Every scored run is written as one JSON line to `<repo>/runs/results.jsonl`, so setups can be compared later.

- `src/shared/results.ts`: `export interface ResultRow { when: string; suite: string; level: string; server: string; model: string; setup: string; pass: boolean; verdict: string; toolCalls: number | null; seconds: number | null; trace: string | null; }` (`setup` is a free label such as `agent` or `workflow fpga-block`; `verdict` is a short word such as `PASS`, `FAIL`, `TIME`, `NO_CANDIDATE`, `JUDGE_ERROR`).
- `src/results.ts`: `appendResult(runsDir, row)` and `readResults(runsDir)` (skips broken lines; newest first; at most 2000).
- `src/cli-result.ts` + `npm run result -- --suite gain --level easy --server local --model m --setup agent --verdict PASS [--tool-calls 12] [--seconds 41] [--trace path]`: appends one row; `pass` is true only for verdict `PASS`; `when` is now in ISO format. Pure argument parsing in an exported function with tests.
- `scripts/eval_local.sh` and the H script below call it once per run. A failure to record must not fail the run.

## 2. The medium task, and one script for both levels

- Rename the logic of `scripts/h_easy.sh` into `scripts/h_task.sh <path to ai_demo> <easy|medium> [server] [model] [-n runs] [-t seconds]` and keep `scripts/h_easy.sh` as a two-line wrapper that calls it with `easy` (so existing instructions keep working).
- Levels: `easy` -> module `red_pitaya_gain_block`, task file `tasks/h-easy.md`; `medium` -> module `red_pitaya_fir_block`, task file `tasks/h-medium.md`. The old harness is asked for the workspace with `run_demo.sh --track H --level <level> --setup-only` and judged with `harness/judge/notch/run_judge.py <run dir> <candidate> --level <level>`, exactly as the current script does for easy. NEVER read, copy or print anything from `harness/judge/` in the old harness: those files are hidden from agents by design.
- `-n` repeats the whole procedure (fresh workspace each time) and prints `PASSED k of n` at the end; `-t` is the per-run time limit (default 600) passed to the agent as `--max-seconds`. Each run is recorded with suite `H`, the level, and verdict from the judge (`PASS`, `FAIL`, `JUDGE_ERROR`, `NO_CANDIDATE`, or `TIME` when the agent hit the limit and the judge then failed).
- Create `tasks/h-medium.md` with exactly this text:

```
Implement the Verilog module `red_pitaya_fir_block` as specified in `tasks/H/fir_spec.md`. Read that file first. The bit-true Python model is `tasks/H/fir_model.py`.

1. Write the module to `pyrpl/pyrpl/fpga/rtl/red_pitaya_fir_block.v`.
2. Write a self-checking testbench `tb/tb_fir_block.v`. It must write the tap registers through the bus, drive `dat_i`, and compare `dat_o` with values you work out from the arithmetic in the spec. Use at least two tap sets, an impulse and a step input, and inputs that saturate. Print one line starting with PASS or FAIL for each check.
3. Run run_sim with both files. Fix the design until every check passes.
4. Write `AGENT_REPORT.md`: the design, the latency you chose, the last run_sim result, and any remaining issues.
```

- `bash -n` both scripts. LF line endings. They must work in Git Bash on Windows and on Linux. Do not run them (they need a model server and the old harness).

## 3. Results screen (Lab)

- Route `GET /api/results` -> `ResultRow[]` (`createAppServer` option `runsDirs` already exists; read `results.jsonl` from the first one).
- `web/src/api.ts`: `results()`.
- `web/src/App.tsx`: a checkbox `Lab tools` in the header (stored in localStorage as `ab.lab`, default on). When on, a tab `Results` appears after the other tabs, visually separated by a thin left border and a small muted label `Lab, only you`. When off, the tab is hidden and, if it was open, the view goes back to `Work`. Lab is for the owner's own testing and will be switched off for colleagues, so keep it isolated: everything Lab lives in `web/src/results/` and this one tab.
- `web/src/results/ResultsScreen.tsx` (+ `results.css`, pure helpers in `logic.ts` with tests):
  - Header: `<h1>Results</h1>`, a `Reload` button, and filters as selects: `Suite`, `Level`, `Model` (each with `All`).
  - A row of summary cards, one per distinct (suite, level, model, setup) in the filtered rows, sorted by suite, level, then pass rate descending: small muted title `<suite> <level> · <setup>`, the model (small, mono), a large `<k> of <n> passed`, and an 8px bar (`var(--pill)` track, `var(--acc)` fill) for the pass rate.
  - A table-like grid `All runs` (CSS grid rows, not a `<table>`): When (local date and time), Suite, Level, Setup, Model, Verdict (coloured: PASS `tone-ok`, others `tone-bad`), Tool calls, Time (`1m 12s`). Horizontal scroll inside the card when narrow.
  - Empty: `No scored runs yet. Runs of scripts/eval_local.sh and scripts/h_task.sh are listed here.`

## 4. Development mode on the office server

The owner will run the app on a Linux server (172.20.1.126) in development mode only: start it by hand and use it. No service, no installer, no deployment.

- `src/server/main.ts`: add `--host <address>` (default `127.0.0.1`). With another host (for example `0.0.0.0` or the server's own address) the server also accepts requests whose `Host` and `Origin` hostname equal that address, or, for `0.0.0.0`, any hostname that is one of this machine's own IPv4 addresses (`os.networkInterfaces()`) or its hostname. Put the allowed-host logic in `createAppServer` options (`allowedHosts: string[]`) and keep the default strict. When started with a non-local host, print: `Warning: anyone who can reach <host>:<port> can read and change files in the project folders. Use this only on a network you trust.`
- Tests for the allowed-host rule (default rejects other hosts; an allowed host passes; an Origin from a different host is still rejected).
- `docs/server.md` (at most 70 lines, plain, one command per code block): what is needed on the server (Node 22.19 or newer, iverilog, a model server), getting the code, `npm install`, `npm run web:install`, `npm run web:build`, setting the model id and paths in `config.local.json` (show a small example with a server entry and commands), starting with `npm run app -- --folder <project>`, and the two ways to open it from another PC: an SSH tunnel (`ssh -L 4600:localhost:4600 <user>@172.20.1.126`, then `http://localhost:4600`; recommended) or `--host 0.0.0.0` on a trusted network. Then the scoring commands (`scripts/h_task.sh` for easy and medium, `scripts/eval_local.sh`). Say plainly that this is development mode and that nothing is installed as a service.
- `README.md` (at most 60 lines): what the project is in three sentences, the folder layout in one short list, quick start on one machine, where agents, skills and workflows live as files, and links to `PLAN.md`, `docs/server.md` and `examples/`.
- Update `PLAN.md`: replace the "Linux install script for the team version" part of milestone 6 with "development mode on the server (docs/server.md); no deployment for now", and add the medium task to the test section. Keep the rest of the file as it is.

## Verify

- `npx vitest run` passes completely (root).
- `npx tsc --noEmit` clean at the root and in `web/`.
- `bash -n scripts/h_task.sh scripts/h_easy.sh scripts/eval_local.sh`.
- Do not start a dev server.
