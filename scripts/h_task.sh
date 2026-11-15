#!/usr/bin/env bash
set -uo pipefail
usage() { echo 'Usage: h_task.sh <path to ai_demo> <easy|medium> [server] [model] [-n runs] [-t seconds] [-w workflow.json]' >&2; exit 2; }
[[ $# -ge 2 ]] || usage
AI_DEMO="$(cd "$1" && pwd)" || exit 2
level="$2"
shift 2
case "$level" in
	easy) MODULE=red_pitaya_gain_block ;;
	medium) MODULE=red_pitaya_fir_block ;;
	*) usage ;;
esac
server=office
model=""
if [[ $# -gt 0 && "$1" != -* ]]; then server="$1"; shift; fi
if [[ $# -gt 0 && "$1" != -* ]]; then model="$1"; shift; fi
runs=1
seconds=600
workflow=""
while [[ $# -gt 0 ]]; do
	[[ $# -ge 2 ]] || usage
	case "$1" in
		-n) runs="$2" ;;
		-t) seconds="$2" ;;
		-w) workflow="$2" ;;
		*) usage ;;
	esac
	shift 2
done
setup_name=agent
if [[ -n "$workflow" ]]; then
	workflow="$(cd "$(dirname "$workflow")" && pwd)/$(basename "$workflow")" || exit 2
	workflow_name="$(node -e 'const fs = require("node:fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).name);' "$workflow")" || exit 2
	setup_name="workflow $workflow_name"
fi
[[ "$runs" =~ ^[1-9][0-9]*$ && "$seconds" =~ ^[1-9][0-9]*$ ]] || usage
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$root/scripts/scoring.sh"
cd "$root" || exit 2
record_model="$model"
[[ -n "$record_model" ]] || record_model="$(configured_model)" || record_model=unknown
yaml() { sed -n "s/^$1:[[:space:]]*\([^[:space:]#]*\).*/\1/p" "$AI_DEMO/config/env.yaml" | head -1 | tr -d '\r'; }
PY="$(yaml python_cmd)"; PY="${PY:-python3}"
IV="$(yaml iverilog_dir)"
if [[ -n "$IV" && "$IV" != auto ]]; then export PATH="$IV:$PATH"; fi
passed=0
for ((i=1; i<=runs; i++)); do
	start=$SECONDS
	verdict=JUDGE_ERROR
	metrics=()
	setup="$(bash "$AI_DEMO/harness/run_demo.sh" --track H --level "$level" --setup-only)"
	setup_code=$?
	setup="$(printf '%s\n' "$setup" | tr -d '\r')"
	printf '%s\n' "$setup"
	WS="$(printf '%s\n' "$setup" | sed -n 's/^workspace ready: \(.*\)  (track.*/\1/p')"
	RUN="$(printf '%s\n' "$setup" | sed -n 's/^run dir: //p')"
	if [[ "$setup_code" != 0 || ! -d "$WS" || ! -d "$RUN" ]]; then
		echo 'Could not prepare the workspace or run folder.' >&2
	elif mkdir -p "$RUN/agent_bench"; then
		log="$RUN/agent_bench/agent.log"
		args=(--server "$server" --folder "$(native "$WS")" --max-seconds "$seconds" --protect "tasks/H/gain_spec.md,tasks/H/gain_model.py,tasks/H/fir_spec.md,tasks/H/fir_model.py")
		cli=src/cli.ts
		if [[ -n "$workflow" ]]; then
			cli=src/cli-workflow.ts
			design="pyrpl/$(yaml pyrpl_rtl)/$MODULE.v"
			if [[ ! -f "$WS/$design" ]]; then
				found="$(find "$WS" -name "$MODULE.v" -not -path '*/.git/*' | head -1)"
				[[ -z "$found" ]] || design="$found"
			fi
			design="${design#"$WS/"}"
			tb="$(sed -n 's/.*testbench `\([^`]*\)`.*/\1/p' "$root/tasks/h-$level.md" | head -1 | tr -d '\r')"
			args+=(--workflow "$(native "$workflow")" --no-pause --task-file "$(native "$root/tasks/h-$level.md")" --var "design=$design" --var "tb=$tb")
		else
			args+=(--task-file "$(native "$root/tasks/h-$level.md")" --runs "$(native "$RUN/agent_bench")")
		fi
		[[ -z "$model" ]] || args+=(--model "$model")
		echo '=== agent'
		npx tsx "$cli" "${args[@]}" 2>&1 | tee "$log"
		agent_code=${PIPESTATUS[0]}
		echo "agent exit code: $agent_code"
		calls=$(grep -Ec '^[[:space:]]*[0-9]+\. [[:alnum:]_]+ ' "$log" || true)
		trace="$(sed -n 's/^Trace //p' "$log" | tail -1 | tr -d '\r')"
		metrics=(--tool-calls "$calls")
		[[ -z "$trace" ]] || metrics+=(--trace "$trace")
		echo '=== judge'
		CAND="$WS/pyrpl/$(yaml pyrpl_rtl)/$MODULE.v"
		[[ -f "$CAND" ]] || CAND="$(find "$WS" -name "$MODULE.v" -not -path '*/.git/*' | head -1)"
		if [[ -z "$CAND" || ! -f "$CAND" ]]; then
			verdict=NO_CANDIDATE
		else
			"$PY" "$(native "$AI_DEMO/harness/judge/notch/run_judge.py")" "$(native "$RUN")" "$(native "$CAND")" --level "$level"
			rc=$?
			case "$rc" in
				0) verdict=PASS ;;
				1) verdict=FAIL; if grep -q '^Ended: time' "$log"; then verdict=TIME; fi ;;
				*) verdict=JUDGE_ERROR ;;
			esac
		fi
		if grep -rqs 'CANARY-' "$RUN/agent_bench" "$WS" --exclude-dir=.git; then
			echo 'LEAK CHECK: canary found, run is INVALID'
			verdict=FAIL
		else
			echo 'LEAK CHECK: clean'
		fi
		echo "judge result: $RUN/judge.json"
		echo "agent trace: $RUN/agent_bench"
	fi
	[[ "$verdict" != PASS ]] || passed=$((passed + 1))
	elapsed=$((SECONDS - start))
	echo "JUDGE: $verdict"
	echo "run $i: $verdict, $elapsed s"
	record_result --suite H --level "$level" --server "$server" --model "$record_model" --setup "$setup_name" --verdict "$verdict" --seconds "$elapsed" "${metrics[@]}"
done
echo "PASSED $passed of $runs"
[[ "$passed" == "$runs" ]]
