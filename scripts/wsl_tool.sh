#!/usr/bin/env bash
# Run an OSS CAD Suite tool (yosys, verilator) installed in WSL, from Windows.
# Usage: bash scripts/wsl_tool.sh <tool> [args...]; Windows paths in the arguments become /mnt/<drive>/... paths.
# Env: WSL_DISTRO (default Ubuntu-22.04), CAD_BIN (default /home/siddhartha/tools/oss-cad-suite/bin).
set -u
tool=$1; shift
distro=${WSL_DISTRO:-Ubuntu-22.04}
bin=${CAD_BIN:-/home/siddhartha/tools/oss-cad-suite/bin}
args=()
for a in "$@"; do
	# Convert every Windows path inside the argument (also inside a yosys script such as "read_verilog -sv C:\x\a.v").
	a=$(printf '%s' "$a" | sed -E 's#([A-Za-z]):[\\/]([^ ;"]*)#/mnt/\L\1\E/\2#g; s#\\#/#g')
	args+=("$a")
done
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"
exec wsl -d "$distro" -e "$bin/$tool" "${args[@]}"
