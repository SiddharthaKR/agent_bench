#!/usr/bin/env bash
# Score VerilogEval on the office server. Run scripts/server_setup.sh once first.
# Edit the values below, then run from the repository root:  bash scripts/server_run.sh
set -uo pipefail

# ---- Values to change ----
SET="heldout"            # dev | heldout | all
WHAT="both"              # raw | harness | both  (both also prints the comparison)
REPEATS=3                # runs per problem; one run can swing by about 3 problems
SECONDS_PER_PROBLEM=120  # raise (e.g. 300) if you see many TIME verdicts
LIMIT=""                 # number of problems for a quick try, e.g. 3; empty = all
WORKFLOW=""              # harness only: e.g. workflows/fpga-fast.json; empty = plain agent
# --------------------------

cd "$(dirname "${BASH_SOURCE[0]}")/.."
[ -f config.local.json ] || { echo "Run scripts/server_setup.sh first."; exit 2; }
model="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("config.local.json","utf8")).servers.office.model)')"
compile="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("config.local.json","utf8")).commands.compile[0])')"
export PATH="$(dirname "$compile"):$PATH"

common=(-s office -m "$model" -r "$REPEATS" -t "$SECONDS_PER_PROBLEM")
[ -n "$LIMIT" ] && common+=(-n "$LIMIT")
stamp="$(date +%Y%m%d-%H%M%S)"
raw=""; harness=""

# The runners exit 1 when any problem fails; that is a result, not an error. Their last line is the run folder.
if [ "$WHAT" = raw ] || [ "$WHAT" = both ]; then
	echo "== Raw model, $SET"
	raw="$(bash scripts/verilog_eval_raw.sh "$SET" "${common[@]}" | tee /dev/stderr | tail -1)"
fi
if [ "$WHAT" = harness ] || [ "$WHAT" = both ]; then
	extra=(); [ -n "$WORKFLOW" ] && extra=(-w "$WORKFLOW")
	echo "== Harness, $SET"
	harness="$(bash scripts/verilog_eval.sh "$SET" "${common[@]}" "${extra[@]}" | tee /dev/stderr | tail -1)"
fi
case "$WHAT" in raw|harness|both) ;; *) echo "WHAT must be raw, harness or both"; exit 2;; esac

if [ -n "$raw" ] && [ -n "$harness" ]; then
	echo "== Comparison"
	node scripts/verilog_eval_report.mjs --compare "$harness" "$raw" | tee "runs/compare-$SET-$stamp.txt"
	echo "Saved to runs/compare-$SET-$stamp.txt"
else
	echo "Run folder: ${raw:-$harness}"
	echo "Compare later with: node scripts/verilog_eval_report.mjs --compare <harness folder> <raw folder>"
fi
