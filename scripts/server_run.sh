#!/usr/bin/env bash
# Score VerilogEval on the office server. Run scripts/server_setup.sh once first.
# Run from the repository root; see docs/usage.md for every case.
set -uo pipefail

# ---- Defaults (override with arguments, see docs/usage.md) ----
SET="heldout"            # dev | heldout | all
WHAT="both"              # raw | harness | both  (both also prints the comparison)
REPEATS=3                # runs per problem; one run can swing by about 3 problems
SECONDS_PER_PROBLEM=120  # raise (e.g. 300) if you see many TIME verdicts
LIMIT=""                 # number of problems for a quick try, e.g. 3; empty = all
WORKFLOW=""              # harness only: e.g. workflows/fpga-fast.json; empty = plain agent
# --------------------------
# Usage: bash scripts/server_run.sh [dev|heldout|all] [raw|harness|both] [-r repeats] [-t seconds] [-n limit] [-w workflow]
[ $# -gt 0 ] && case "$1" in dev|heldout|all) SET="$1"; shift;; esac
[ $# -gt 0 ] && case "$1" in raw|harness|both) WHAT="$1"; shift;; esac
while [ $# -gt 0 ]; do
	case "$1" in
		-r) REPEATS="$2"; shift 2;;
		-t) SECONDS_PER_PROBLEM="$2"; shift 2;;
		-n) LIMIT="$2"; shift 2;;
		-w) WORKFLOW="$2"; shift 2;;
		*) echo "Unknown argument: $1. Usage: bash scripts/server_run.sh [dev|heldout|all] [raw|harness|both] [-r N] [-t S] [-n N] [-w file]"; exit 2;;
	esac
done
echo "Set: $SET, what: $WHAT, repeats: $REPEATS, seconds per problem: $SECONDS_PER_PROBLEM${LIMIT:+, first $LIMIT problems}${WORKFLOW:+, workflow $WORKFLOW}"

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
