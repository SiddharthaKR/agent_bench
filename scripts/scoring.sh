#!/usr/bin/env bash
# Shared path conversion and best-effort result recording.
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s\n' "$1"; fi; }

configured_model() {
	node --input-type=module - "$(native "$root")" "$server" <<'NODE'
import fs from "node:fs";
import path from "node:path";
const [root, server] = process.argv.slice(2);
const shared = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const localPath = path.join(root, "config.local.json");
const local = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, "utf8")) : {};
const model = local.servers?.[server]?.model ?? shared.servers?.[server]?.model;
if (!model) process.exit(1);
process.stdout.write(model);
NODE
}

record_result() {
	npm run --silent result -- "$@" || echo 'Could not record the result.' >&2
}
