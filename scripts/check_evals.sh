#!/usr/bin/env bash
set -u
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root" || exit 2
source "$root/scripts/scoring.sh"
node --input-type=module - "$(native "$root")" <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { qualityReport } from "./src/tools/quality.ts";
const root = process.argv[2];
const shared = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const localPath = path.join(root, "config.local.json");
const local = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, "utf8")) : {};
const commands = { ...shared.commands, ...local.commands };
let broken = false;
for (const name of fs.readdirSync(path.join(root, "evals")).sort()) {
	const metadata = path.join(root, "evals", name, "eval.json");
	if (!fs.existsSync(metadata)) continue;
	const folder = fs.mkdtempSync(path.join(os.tmpdir(), "check-eval-"));
	let ok = true;
	let output = "";
	try {
		const { design, tb } = JSON.parse(fs.readFileSync(metadata, "utf8"));
		const files = [path.join(root, "evals-ref", name, path.basename(design)), path.join(root, "evals", name, tb)];
		fs.mkdirSync(path.join(folder, ".build"));
		const out = ".build/eval.out";
		for (const template of [commands.compile?.length ? commands.compile : ["iverilog", "-o", "{out}", "{files}"], commands.simulate?.length ? commands.simulate : ["vvp", "{out}"]]) {
			const expanded = template.flatMap(part => part === "{files}" ? files : [part.replaceAll("{out}", out)]);
			const result = spawnSync(expanded[0], expanded.slice(1), { cwd: folder, encoding: "utf8", timeout: 60000 });
			output += (result.stdout ?? "") + (result.stderr ?? "");
			if (result.error || result.status !== 0) { ok = false; break; }
		}
		ok &&= /ALL TESTS PASSED/.test(output) && !/\b(?:FAIL|FAILED|ERROR|MISMATCH)\b/i.test(output);
		console.log(`${name} quality:`);
		const quality = await qualityReport([files[0]], { commands, cwd: root });
		ok &&= quality.pass;
	} catch (error) { ok = false; output += String(error); }
	finally { fs.rmSync(folder, { recursive: true, force: true }); }
	console.log(`${name}: ${ok ? "ok" : "BROKEN"}`);
	if (!ok) { broken = true; console.error(output); }
}
process.exitCode = broken ? 1 : 0;
NODE
