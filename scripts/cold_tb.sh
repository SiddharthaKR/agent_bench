#!/usr/bin/env bash
# Cold testbenches: Codex writes one self-checking testbench per VerilogEval problem from the spec alone.
# Usage: bash scripts/cold_tb.sh <problem list file> [out dir, default evals-external/cold-tb]
# Each problem runs in an empty temp folder holding only spec.md, so Codex never sees RTL, references or the hidden test.
# Output: <out>/<problem>/tb_top.sv and codex.log. Existing testbenches are kept (delete one to regenerate).
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
list=$1; out=${2:-$here/evals-external/cold-tb}
dataset="$here/external/verilog-eval/dataset_spec-to-rtl"
mkdir -p "$out"
prompt='spec.md specifies a hardware module named TopModule. Write tb_top.sv: a self-checking SystemVerilog testbench (module tb_top) for Icarus Verilog 12 (iverilog -g2012) that instantiates TopModule by port name exactly as the spec gives the ports. Derive every expected value from the specification alone. Cover the specified behaviour, reset and edge cases, with enough random stimulus for combinational logic. Drive inputs away from the active clock edge. For each check print "PASS <name>" or "FAIL <name> expected=<v> got=<v> inputs=<...>", and end with $finish. Do not write TopModule and do not look outside this folder. Write only tb_top.sv.'
while read -r name; do
	name=${name%$'\r'}; [ -z "$name" ] && continue
	[ -s "$out/$name/tb_top.sv" ] && { echo "$name: kept"; continue; }
	mkdir -p "$out/$name"
	work=$(mktemp -d)
	cp "$dataset/${name}_prompt.txt" "$work/spec.md"
	(cd "$work" && codex exec -s workspace-write --skip-git-repo-check "$prompt" < /dev/null) > "$out/$name/codex.log" 2>&1
	if [ -s "$work/tb_top.sv" ]; then cp "$work/tb_top.sv" "$out/$name/"; echo "$name: written"; else echo "$name: no testbench"; fi
	grep -qiE "verilog-eval|_ref\.sv|_test\.sv|dataset_spec" "$out/$name/codex.log" && echo "$name: WARNING log mentions benchmark files"
	rm -rf "$work"
done < "$list"
