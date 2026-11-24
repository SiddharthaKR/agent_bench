# Usage manual: scoring VerilogEval on the office server

Run every command from the repository folder on the server (172.20.1.126), in a bash shell.

VerilogEval has 156 problems, split into two parts with no overlap:

| Set | Problems | Meaning |
|---|---|---|
| `dev` | 39 | Used to improve the harness |
| `heldout` | 117 | Never studied; the honest score |
| `all` | 156 | Both together |

**Raw** means the model answers once with no harness. **Harness** means the model works with tools and checks. **Both** runs raw, then the harness, and prints a side-by-side comparison.

## 1. Once per server: setup

```bash
git pull origin master
```
Open `scripts/server_setup.sh` and set `MODEL_ID` to the exact model name LM Studio shows. Then run:
```bash
bash scripts/server_setup.sh
```

## 2. Quick test first (3 problems, about 5 minutes)

```bash
bash scripts/server_run.sh dev both -r 1 -n 3
```
If this prints a comparison with PASS lines, everything works.

## 3. Ready commands for each case

| Case | Command |
|---|---|
| Dev, raw and harness | `bash scripts/server_run.sh dev both` |
| Held-out, raw and harness | `bash scripts/server_run.sh heldout both` |
| Everything (156), raw and harness | `bash scripts/server_run.sh all both` |
| Dev, raw only | `bash scripts/server_run.sh dev raw` |
| Dev, harness only | `bash scripts/server_run.sh dev harness` |
| Held-out, raw only | `bash scripts/server_run.sh heldout raw` |
| Held-out, harness only | `bash scripts/server_run.sh heldout harness` |
| Held-out, one run instead of three (faster) | `bash scripts/server_run.sh heldout both -r 1` |
| Harness with more time per problem | `bash scripts/server_run.sh dev harness -t 300` |
| Harness with the fpga-fast workflow | `bash scripts/server_run.sh dev harness -w workflows/fpga-fast.json` |

Full results for the deck (dev and held-out separately, one after the other):
```bash
bash scripts/server_run.sh dev both && bash scripts/server_run.sh heldout both
```

## 4. Options

| Option | Default | Meaning |
|---|---|---|
| first word | `heldout` | `dev`, `heldout` or `all` |
| second word | `both` | `raw`, `harness` or `both` |
| `-r N` | 3 | Runs per problem. One run can swing by about 3 problems, so use 3 for dev |
| `-t S` | 120 | Seconds per problem. Raise it (e.g. 300) if many results say `TIME` |
| `-n N` | all | Only the first N problems, for a quick test |
| `-w FILE` | none | Harness only: run a workflow file instead of the plain agent |

## 5. Rough time on the server

Depends on the model. As a guide from the 12B on a laptop: raw about 20 s per problem, harness about 60 to 80 s.

| Command | Problem runs |
|---|---|
| `dev both` (3 repeats) | 39 x 3 raw + 39 x 3 harness |
| `heldout both` (3 repeats) | 117 x 3 raw + 117 x 3 harness |
| `heldout both -r 1` | 117 raw + 117 harness |

Use `tmux` or `nohup` for long runs so they survive a closed connection:
```bash
nohup bash scripts/server_run.sh heldout both > runs/heldout.log 2>&1 &
tail -f runs/heldout.log
```

## 6. Where the results are

| File | Contents |
|---|---|
| `runs/compare-dev-<time>.txt` | Dev: one row per problem, raw against harness, totals at the end |
| `runs/compare-heldout-<time>.txt` | Held-out: the same |
| `runs/verilog-eval/<time>/` and `runs/verilog-eval-raw/<time>/` | Every problem's files and trace |
| `runs/results.jsonl` | One line per problem run |

To fill the deck, send the two `compare-*.txt` files.

## 7. Common problems

| Message | Fix |
|---|---|
| `Run scripts/server_setup.sh first.` | Do step 1 |
| Many `TIME` verdicts | Add `-t 300` |
| `NO_FILE` | The model never wrote the design file; normal for some problems |
| Connection refused | Start LM Studio's server and load the model |
