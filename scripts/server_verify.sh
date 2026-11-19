#!/usr/bin/env bash
# Set up the office server and score VerilogEval held-out: raw model against the harness.
# Edit the values below, then run from the repository root:  bash scripts/server_verify.sh
set -euo pipefail

# ---- Values to change ----
MODEL_ID="SET-THE-LM-STUDIO-MODEL-ID"      # exact model ID LM Studio shows
BASE_URL="http://127.0.0.1:1234/v1"         # LM Studio OpenAI-compatible URL
IVERILOG="/usr/bin/iverilog"
VVP="/usr/bin/vvp"
REPEATS=3                                    # runs per problem; one run can swing by about 3 problems
SECONDS_PER_PROBLEM=120                      # raise (e.g. 300) if you see many TIME verdicts
# --------------------------

cd "$(dirname "${BASH_SOURCE[0]}")/.."
[ "$MODEL_ID" = "SET-THE-LM-STUDIO-MODEL-ID" ] && { echo "Set MODEL_ID at the top of $0 first."; exit 2; }
export PATH="$(dirname "$IVERILOG"):$(dirname "$VVP"):$PATH"

echo "== Checking tools"
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<19)) {console.error("Node 22.19 or newer needed, found "+process.versions.node); process.exit(2)}'
"$IVERILOG" -V 2>&1 | head -1
[ -x "$VVP" ] || { echo "vvp not found at $VVP"; exit 2; }
curl -sf "$BASE_URL/models" > /dev/null || { echo "No model server at $BASE_URL; start LM Studio and load the model."; exit 2; }

echo "== Installing dependencies"
npm install --no-audit --no-fund

echo "== Writing config.local.json"
cat > config.local.json <<EOF
{
  "servers": {
    "office": { "baseUrl": "$BASE_URL", "model": "$MODEL_ID" }
  },
  "commands": {
    "compile": ["$IVERILOG", "-g2012", "-o", "{out}", "{files}"],
    "simulate": ["$VVP", "{out}"]
  }
}
EOF

echo "== Fetching VerilogEval (pinned)"
[ -d external/verilog-eval/.git ] || git clone https://github.com/NVlabs/verilog-eval external/verilog-eval
git -C external/verilog-eval checkout -q c498220d0a52248f8e3fdffe279075215bde2da6
node scripts/verilog_eval_report.mjs --write-split

echo "== Checking the judge with the reference solutions (no model calls)"
node scripts/verilog_eval_raw.mjs --check-references

# The runners exit 1 when any problem fails; that is a result, not an error.
echo "== Raw model, held-out"
raw="$(bash scripts/verilog_eval_raw.sh heldout -s office -m "$MODEL_ID" -r "$REPEATS" -t "$SECONDS_PER_PROBLEM" | tee /dev/stderr | tail -1)" || true

echo "== Harness, held-out"
harness="$(bash scripts/verilog_eval.sh heldout -s office -m "$MODEL_ID" -r "$REPEATS" -t "$SECONDS_PER_PROBLEM" | tee /dev/stderr | tail -1)" || true

echo "== Comparison"
node scripts/verilog_eval_report.mjs --compare "$harness" "$raw" | tee runs/server-verify-comparison.txt
echo "Saved to runs/server-verify-comparison.txt"
