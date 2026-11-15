#!/usr/bin/env bash
set -eu
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
exec node scripts/verilog_eval_raw.mjs "$@"
