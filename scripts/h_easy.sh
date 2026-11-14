#!/usr/bin/env bash
# Runs track H easy of the old FPGA harness (ai_demo) with this agent, then
# scores the result with that harness's hidden judge.
#
#   bash scripts/h_easy.sh <path to ai_demo> [server name] [model id]
#
# server name: an entry under "servers" in config.json (default: office).
# model id:    overrides the model of that entry.
set -uo pipefail

AI_DEMO="$(cd "${1:?usage: h_easy.sh <path to ai_demo> [server] [model]}" && pwd)"
SERVER="${2:-office}"
MODEL="${3:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE=red_pitaya_gain_block

# Windows Python and Node need C:/ paths; on Linux this changes nothing.
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }
yaml() { sed -n "s/^$1:[[:space:]]*\([^[:space:]#]*\).*/\1/p" "$AI_DEMO/config/env.yaml" | head -1; }

# 1. Fresh workspace, prepared by the old harness (this replaces its workspace folder).
setup="$(bash "$AI_DEMO/harness/run_demo.sh" --track H --level easy --setup-only)" || { echo "$setup"; echo "setup failed" >&2; exit 2; }
echo "$setup"
WS="$(echo "$setup" | sed -n 's/^workspace ready: \(.*\)  (track.*/\1/p')"
RUN="$(echo "$setup" | sed -n 's/^run dir: //p')"
if [ ! -d "$WS" ] || [ ! -d "$RUN" ]; then echo "could not read the workspace or run folder from run_demo.sh" >&2; exit 2; fi

PY="$(yaml python_cmd)"; PY="${PY:-python3}"
IV="$(yaml iverilog_dir)"
if [ -n "$IV" ] && [ "$IV" != auto ]; then export PATH="$IV:$PATH"; fi

# 2. The agent.
cd "$HERE" || exit 2
args=(--server "$SERVER" --folder "$(native "$WS")" --task-file "$(native "$HERE/tasks/h-easy.md")" --runs "$(native "$RUN/agent_bench")")
[ -n "$MODEL" ] && args+=(--model "$MODEL")
echo
echo "=== agent"
npx tsx src/cli.ts "${args[@]}"
echo "agent exit code: $?"

# 3. The hidden judge. The agent never sees it.
echo
echo "=== judge"
CAND="$WS/pyrpl/$(yaml pyrpl_rtl)/$MODULE.v"
[ -f "$CAND" ] || CAND="$(find "$WS" -name "$MODULE.v" -not -path '*/.git/*' | head -1)"
if [ -z "$CAND" ] || [ ! -f "$CAND" ]; then
	echo "JUDGE: NO_CANDIDATE (the agent wrote no $MODULE.v)"
	exit 1
fi
"$PY" "$(native "$AI_DEMO/harness/judge/notch/run_judge.py")" "$(native "$RUN")" "$(native "$CAND")" --level easy
rc=$?
case $rc in 0) verdict=PASS ;; 1) verdict=FAIL ;; *) verdict="JUDGE ERROR (exit $rc)" ;; esac

# 4. Hidden files carry a canary string. It must not be in the trace or the workspace.
if grep -rqs "CANARY-" "$RUN/agent_bench" "$WS" --exclude-dir=.git; then leak="canary found, run is INVALID"; else leak=clean; fi

echo
echo "JUDGE: $verdict"
echo "LEAK CHECK: $leak"
echo "judge result: $RUN/judge.json"
echo "agent trace:  $RUN/agent_bench"
[ "$rc" -eq 0 ] && [ "$leak" = clean ]
