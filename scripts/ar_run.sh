#!/usr/bin/env bash
# One autoresearch scoring run from the frozen worktree ../Harness-ar, in chunks to keep memory low.
# Usage: bash scripts/ar_run.sh <label> <commit> [verilog_eval.sh options, e.g. -s local12 -t 300 -w workflows/x.json]
# Env: SET=dev|heldout (default dev), CHUNK=8, MIN_GB=3, RAW=1 for the raw runner.
# Between chunks the model is unloaded (frees what the server leaks) and the next chunk waits until
# at least MIN_GB of RAM is available. Writes runs/ar-<label>.log; the last lines are the totals.
set -u
label=$1; commit=$2; shift 2
set_name=${SET:-dev}; chunk=${CHUNK:-8}; min_gb=${MIN_GB:-3}
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tree="$here/../Harness-ar"
log="$here/runs/ar-$label.log"
parts="$here/runs/ar-$label.chunks"
runner=scripts/verilog_eval.sh; [ "${RAW:-}" = 1 ] && runner=scripts/verilog_eval_raw.sh
avail() { powershell -NoProfile -c '[int]((Get-Counter "\Memory\Available MBytes").CounterSamples[0].CookedValue)'; }
mem() { powershell -NoProfile -c '"{0:N1} GB available; committed {1:N1} GB" -f ((Get-Counter "\Memory\Available MBytes").CounterSamples[0].CookedValue/1KB), ((Get-Counter "\Memory\Committed Bytes").CounterSamples[0].CookedValue/1GB)'; }
unload() { ollama stop gemma4-12b-ctx16k > /dev/null 2>&1; ollama stop gemma4:12b > /dev/null 2>&1; sleep 5; }

git -C "$tree" checkout -q --detach "$commit" || exit 2
rm -rf "$parts"; mkdir -p "$parts"
split -l "$chunk" -d "$here/evals-external/verilog-eval/$set_name.txt" "$parts/part-"
echo "run $label at $(git -C "$tree" rev-parse --short HEAD), $set_name, chunks of $chunk, options: $*" > "$log"
for part in "$parts"/part-*; do
	unload
	for i in $(seq 1 30); do [ "$(avail | tr -d '\r')" -ge $((min_gb * 1024)) ] && break; sleep 10; done
	echo "== $(basename "$part"): memory $(mem)" >> "$log"
	(cd "$tree" && PATH="/c/iverilog/bin:$PATH" bash "$runner" "$part" "$@") >> "$log" 2>&1
done
unload
echo "memory after (model unloaded): $(mem)" >> "$log"
# Totals over all chunks, from the per-problem lines.
grep -E "^Prob[0-9]+_.*: [A-Z_]+, " "$log" | node -e '
const rows = require("fs").readFileSync(0, "utf8").trim().split("\n").filter(Boolean).map((l) => ({ v: l.match(/: ([A-Z_]+),/)[1], s: Number(l.match(/([\d.]+) s$/)[1]) }));
const t = rows.map((r) => r.s).sort((a, b) => a - b), m = Math.floor(t.length / 2);
const counts = {}; for (const r of rows) counts[r.v] = (counts[r.v] ?? 0) + 1;
console.log(`TOTAL passed ${counts.PASS ?? 0} of ${rows.length}; median ${(t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2).toFixed(1)} s; ${Object.entries(counts).map(([k, v]) => k + " " + v).join("; ")}`);' >> "$log"
tail -2 "$log"
