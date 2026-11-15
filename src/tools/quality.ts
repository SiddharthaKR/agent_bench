import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.ts";
import type { QualityCommands } from "../shared/api.ts";
import type { CommandConfig, Exec } from "../types.ts";
import { realExec } from "./exec.ts";
import { qualityLint, type LintFinding } from "./lint.ts";

export interface QualityFinding extends LintFinding {
	file: string;
}

export interface QualityReport {
	pass: boolean;
	findings: QualityFinding[];
	ran: string[];
	text: string;
}

const FAIL_CODES = new Set(["LATCH", "MULTIDRIVEN", "BLKSEQ", "COMBDLY", "WIDTH", "UNDRIVEN", "CASEINCOMPLETE"]);

export async function qualityReport(files: string[], options: { commands?: QualityCommands & Partial<CommandConfig>; exec?: Exec; cwd?: string; print?: (text: string) => void } = {}): Promise<QualityReport> {
	if (!files.length) throw new Error("Give at least one RTL file.");
	const cwd = options.cwd ?? process.cwd();
	const findings: QualityFinding[] = [];
	for (const file of files) findings.push(...qualityLint(await readFile(path.resolve(cwd, file), "utf8")).map(f => ({ file, ...f })));
	const ran: string[] = [];
	const exec = options.exec ?? realExec;
	const commands = options.commands ?? (await loadConfig(fileURLToPath(new URL("../../", import.meta.url)))).commands;
	const temporary = await mkdtemp(path.join(os.tmpdir(), "rtl-quality-"));
	try {
		const icarus = commands.compile?.length ? [...commands.compile] : ["iverilog", "-g2012", "-o", "{out}", "{files}"];
		if (!icarus.includes("-Wall")) icarus.splice(1, 0, "-Wall");
		for (const [name, template] of [["verilator", commands.lint], ["synth", commands.synth], ["iverilog", icarus]] as const) {
			if (!template?.length) continue;
			const expanded = template.flatMap(part => part === "{files}" ? files : [part.replaceAll("{files}", files.map(file => `"${file.replaceAll("\\", "/").replaceAll('"', '\\"')}"`).join(" ")).replaceAll("{out}", path.join(temporary, "lint.out"))]);
			const result = await exec(expanded[0]!, expanded.slice(1), { cwd, timeoutMs: 10000 });
			if (result.notFound) continue;
			ran.push(name);
			const output = `${result.stdout}\n${result.stderr}`;
			if (name === "synth") {
				if (result.code !== 0) findings.push({ file: files[0]!, line: 1, rule: "synth", severity: "error", message: output.split(/\r?\n/).find(line => /error/i.test(line))?.trim() || (result.timedOut ? "Synthesis timed out." : "Synthesis failed.") });
			} else if (name === "verilator") {
				for (const m of output.matchAll(/%Warning-([\w]+):[^\S\r\n]*([^\r\n]*)/g)) {
					const location = /^(.*?):(\d+):(?:\d+:)?\s*(.*)/.exec(m[2]!);
					findings.push({ file: location?.[1] ?? files[0]!, line: Number(location?.[2] ?? 1), rule: `verilator:${m[1]}`, severity: FAIL_CODES.has(m[1]!) ? "error" : "note", message: (location?.[3] ?? m[2]!).trim() });
				}
			} else {
				for (const line of output.split(/\r?\n/)) {
					const m = /^(.*?):(\d+):\s*warning:\s*(.*)/i.exec(line);
					if (m) findings.push({ file: m[1]!, line: Number(m[2]), rule: "iverilog", severity: "note", message: m[3]!.trim() });
					else if (/^\s*warning:/i.test(line)) findings.push({ file: files[0]!, line: 1, rule: "iverilog", severity: "note", message: line.replace(/^\s*warning:\s*/i, "").trim() });
				}
			}
		}
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
	const pass = !findings.some(f => f.severity === "error");
	const summary = `${pass ? "QUALITY PASS" : `QUALITY FAIL (${findings.length} findings)`}`;
	const text = [...findings.map(f => `${f.file}:${f.line}: ${f.rule}: ${f.message}`), `Tools: ${ran.join(", ") || "none"}`, summary].join("\n");
	(options.print ?? console.log)(text);
	return { pass, findings, ran, text };
}
