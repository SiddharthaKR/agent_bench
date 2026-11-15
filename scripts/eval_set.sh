#!/usr/bin/env bash
set -u
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root" || exit 2
usage() { echo 'Usage: eval_set.sh <tuning|heldout> [-n runs] [-s server] [-w workflow.json] [-t seconds] [-k a,b] [-m model]' >&2; exit 2; }
[[ $# -gt 0 ]] || usage
selected="$1"
shift
[[ "$selected" == tuning || "$selected" == heldout ]] || usage
args=("$@")
while getopts ':n:s:w:t:k:m:' opt; do
	case "$opt" in n|s|w|t|k|m) ;; *) usage ;; esac
done
shift $((OPTIND - 1))
[[ $# == 0 ]] || usage
tasks="$(node --input-type=module - "$selected" <<'NODE'
import fs from "node:fs";
for (const name of fs.readdirSync("evals").sort()) {
	const file = `evals/${name}/eval.json`;
	if (!fs.existsSync(file)) continue;
	const meta = JSON.parse(fs.readFileSync(file, "utf8"));
	if (meta.set !== process.argv[2]) continue;
	if (!/^[A-Za-z0-9_-]+$/.test(name) || !["easy", "medium", "hard"].includes(meta.level)) throw new Error("Invalid eval metadata.");
	console.log(`${name}\t${meta.level}`);
}
NODE
)" || exit 2
[[ -n "$tasks" ]] || { echo 'No tasks in set.' >&2; exit 2; }
log="$(mktemp)" || exit 2
trap 'rm -f -- "$log"' EXIT
rows=()
failed=0
while IFS=$'\t' read -r name level; do
	echo "Running $name ($level)"
	if ! bash "$root/scripts/eval_local.sh" -e "$name" "${args[@]}" >"$log" 2>&1; then failed=1; fi
	cat "$log"
	passed="?"; runs="?"; total=0; measured=0
	while IFS= read -r line; do
		line="${line%$'\r'}"
		if [[ "$line" =~ ^PASSED\ ([0-9]+)\ of\ ([0-9]+)$ ]]; then
			passed="${BASH_REMATCH[1]}"; runs="${BASH_REMATCH[2]}"
		elif [[ "$line" =~ ^run\ [0-9]+:\ (PASS|FAIL|TIME),\ [0-9]+\ tool\ calls,\ ([0-9]+)\ s$ ]]; then
			total=$((total + BASH_REMATCH[2])); measured=$((measured + 1))
		fi
	done <"$log"
	average="-"
	if (( measured > 0 )); then average="$(awk -v total="$total" -v runs="$measured" 'BEGIN { printf "%.2f", total / runs }')"; fi
	[[ "$passed" != "?" && "$measured" == "$runs" ]] || failed=1
	rows+=("$name" "$level" "$passed/$runs" "$average")
done <<< "$tasks"
printf '\n%-12s %-8s %-15s %s\n' 'Task' 'Level' 'Passed of runs' 'Seconds per run'
printf '%-12s %-8s %-15s %s\n' "${rows[@]}"
exit "$failed"
