#!/usr/bin/env bash
set -u
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root" || exit 2
source "$root/scripts/scoring.sh"
runs=1
server=local
model=""
workflow=""
seconds=300
suite=gain
skills=""
while getopts ':n:s:m:w:t:e:k:' opt; do
	case "$opt" in
		n) runs="$OPTARG" ;;
		s) server="$OPTARG" ;;
		m) model="$OPTARG" ;;
		w) workflow="$OPTARG" ;;
		t) seconds="$OPTARG" ;;
		e) suite="$OPTARG" ;;
		k) skills="$OPTARG" ;;
		*) echo 'Usage: eval_local.sh [-n runs] [-s server] [-m model] [-w workflow.json] [-t seconds] [-e name] [-k a,b]' >&2; exit 2 ;;
	esac
done
[[ "$suite" =~ ^[A-Za-z0-9_-]+$ && -f "evals/$suite/eval.json" ]] || { echo 'Unknown eval.' >&2; exit 2; }
metadata="$(node --input-type=module - "evals/$suite/eval.json" <<'NODE'
import fs from "node:fs";
const meta = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const key of ["level", "design", "tb"]) {
	if (typeof meta[key] !== "string" || !meta[key] || /[\r\n]/.test(meta[key])) throw new Error("Invalid eval metadata.");
	console.log(meta[key]);
}
NODE
)" || exit 2
mapfile -t fields <<< "$metadata"
level="${fields[0]}"
design="${fields[1]}"
tb="${fields[2]}"
[[ "$runs" =~ ^[1-9][0-9]*$ && "$seconds" =~ ^[1-9][0-9]*$ ]] || { echo 'Runs and seconds must be positive integers.' >&2; exit 2; }
record_model="$model"
[[ -n "$record_model" ]] || record_model="$(configured_model)" || record_model=unknown
setup=agent
[[ -z "$workflow" ]] || setup="workflow $(basename "${workflow%.json}")"
[[ -z "$skills" ]] || setup+=" +$skills"
total_start=$SECONDS
passed=0
temp=""
trap '[[ -z "$temp" ]] || rm -rf -- "$temp"' EXIT
for ((i=1; i<=runs; i++)); do
	temp="$(mktemp -d)" || exit 2
	cp -R "evals/$suite/." "$temp/" || exit 2
	start=$SECONDS
	args=(--folder "$(native "$temp")" --server "$server" --max-seconds "$seconds" --protect "$tb,spec.md")
	[[ -z "$model" ]] || args+=(--model "$model")
	[[ -z "$skills" ]] || args+=(--skills "$skills")
	if [[ -n "$workflow" ]]; then
		npx tsx src/cli-workflow.ts --workflow "$(native "$workflow")" --task "$(cat "evals/$suite/task.md")" --no-pause --var "design=$design" --var "tb=$tb" "${args[@]}" >"$temp/agent.log" 2>&1
	else
		npx tsx src/cli.ts --task-file "evals/$suite/task.md" "${args[@]}" >"$temp/agent.log" 2>&1
	fi
	agent_code=$?
	# The check always uses the original testbench, whatever the run did to its copy.
	mkdir -p "$temp/$(dirname "$tb")" && cp "evals/$suite/$tb" "$temp/$tb" || exit 2
	# Resolve configured command arrays in Node so paths with spaces remain single arguments.
	node --input-type=module - "$(native "$root")" "$(native "$temp")" "$design" "$tb" >"$temp/check.log" 2>&1 <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const [root, folder, design, tb] = process.argv.slice(2);
const shared = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const localPath = path.join(root, "config.local.json");
const local = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, "utf8")) : {};
const commands = { ...shared.commands, ...local.commands };
fs.mkdirSync(path.join(folder, ".build"), { recursive: true });
const out = ".build/eval.out";
for (const template of [commands.compile?.length ? commands.compile : ["iverilog", "-o", "{out}", "{files}"], commands.simulate?.length ? commands.simulate : ["vvp", "{out}"]]) {
	const expanded = template.flatMap(part => part === "{files}" ? [design, tb] : [part.replaceAll("{out}", out)]);
	const result = spawnSync(expanded[0], expanded.slice(1), { cwd: folder, encoding: "utf8", timeout: 60000 });
	process.stdout.write(result.stdout ?? "");
	process.stderr.write(result.stderr ?? "");
	if (result.error || result.status !== 0) process.exit(1);
}
NODE
	check_code=$?
	calls=$(grep -Ec '^[[:space:]]*[0-9]+\. [[:alnum:]_]+ ' "$temp/agent.log" || true)
	# The verdict comes from the independent check alone, never from how the agent ended.
	status=FAIL
	if [[ "$check_code" == 0 ]] && grep -q 'ALL TESTS PASSED' "$temp/check.log"; then
		status=PASS
		passed=$((passed + 1))
	elif grep -q 'Ended: time' "$temp/agent.log"; then
		status=TIME
	fi
	elapsed=$((SECONDS - start))
	echo "run $i: $status, $calls tool calls, $elapsed s"
	trace="$(sed -n 's/^Trace //p' "$temp/agent.log" | tail -1 | tr -d '\r')"
	metrics=()
	[[ -z "$trace" ]] || metrics+=(--trace "$trace")
	record_result --suite "$suite" --level "$level" --server "$server" --model "$record_model" --setup "$setup" --verdict "$status" --tool-calls "$calls" --seconds "$elapsed" "${metrics[@]}"
	rm -rf -- "$temp"
	temp=""
done
echo "PASSED $passed of $runs"
echo "Total elapsed: $((SECONDS - total_start)) s"
[[ "$passed" == "$runs" ]]
