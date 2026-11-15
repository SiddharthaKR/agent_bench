#!/usr/bin/env bash
set -eu
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
# Keep arguments intact, including native Windows paths with spaces.
exec node scripts/verilog_eval_report.mjs --run "$@"
