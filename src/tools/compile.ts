import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolContext, ToolOutput, ToolSpec } from "../types.ts";
import { resolveInWorkspace } from "./paths.ts";
import { splitLines, trimLine } from "./util.ts";
import { lintVerilog, qualityLint } from "./lint.ts";
import { checkInterface, isTestbench } from "./interface.ts";
import { checkRegisters } from "./register_check.ts";

export const OUT_PATH = ".build/sim.out";
const TIMEOUT_MS = 60_000;
const SHOWN = 5;

/** `{files}` entries expand to one argument per file; `{out}` is replaced inside any entry. */
export function expandCommand(
	template: string[],
	files: string[],
	out: string,
): { program: string; args: string[] } {
	const [program = "", ...rest] = template;
	const args: string[] = [];
	for (const entry of rest) {
		if (entry === "{files}") args.push(...files);
		else args.push(entry.split("{out}").join(out));
	}
	return { program: program.split("{out}").join(out), args };
}

export function outputLines(...parts: string[]): string[] {
	return parts
		.join("\n")
		.split(/\r?\n/)
		// "I give up." is Icarus Verilog's sign-off, not a message the model can act on.
		.filter((l) => l.trim() !== "" && l.trim() !== "I give up.")
		.map((l) => trimLine(l));
}

export type CompileOutcome = ToolOutput & { files: string[] };

/** Shared by compile and run_sim. */
export async function compileFiles(filesArg: unknown, ctx: ToolContext & { smallFileLines?: number }): Promise<CompileOutcome> {
	const fail = (text: string): CompileOutcome => ({ ok: false, text, files: [] });
	const names = String(filesArg ?? "").split(/\s+/).filter((s) => s !== "");
	if (names.length === 0) return fail("Give at least one file to compile.");

	const rels: string[] = [];
	for (const name of names) {
		const p = resolveInWorkspace(ctx.workspace, name);
		if (!p.ok) return fail(p.text);
		try {
			if (!(await fs.stat(p.abs)).isFile()) return fail(`${p.rel} is not a file.`);
		} catch {
			return fail(`File not found: ${p.rel}`);
		}
		rels.push(p.rel);
	}
	if (ctx.commands.compile.length === 0) return fail("No compile command is configured.");

	try {
		await fs.mkdir(path.join(ctx.workspace, ".build"), { recursive: true });
	} catch (err) {
		return fail(`Could not create the .build folder: ${(err as Error).message}`);
	}

	const { program, args } = expandCommand(ctx.commands.compile, rels, OUT_PATH);
	if (/(?:^|[\\/])iverilog(?:\.exe)?$/i.test(program) && !args.includes("-Wall")) args.unshift("-Wall");
	const r = await ctx.exec(program, args, { cwd: ctx.workspace, timeoutMs: TIMEOUT_MS, signal: ctx.signal });
	const interfaces = await interfaceHints(rels, ctx);
	const failed = (text: string) => fail([text, ...interfaces].join("\n"));
	if (r.notFound) return failed(`The compiler "${program}" is not installed on this machine.`);
	if (r.timedOut) return failed("Compile timed out after 60 s.");

	const lines = outputLines(r.stderr, r.stdout);
	const registers = await checkRegisters(rels, ctx);
	const registerText = registers ? `\n${registers.text}` : "";
	if (r.code === 0) {
		const conflicts: string[] = [];
		for (const file of rels) {
			try {
				const source = await fs.readFile(path.join(ctx.workspace, file), "utf8");
				conflicts.push(...qualityLint(source).filter(f => f.rule === "multi-driver").map(f => `${file}:${f.line}: ${f.message}`));
			} catch { /* A compiled input can disappear before lint. */ }
		}
		const bounds = lines.filter(line => /(?:select|index).*out of bound|out of bound.*(?:select|index)|Constant (?:bit|part) select .* (?:after|before|outside) vector/i.test(line));
		if (registers && !registers.ok) return fail(`Compiled, 0 errors.${registerText}`);
		let text = "Compiled, 0 errors.";
		if (lines.length > 0) text += ` ${lines.length} warning lines; first: ${lines[0]}`;
		// Driver conflicts and out-of-range selects are reported, not enforced: making them fatal cost
		// four dev problems in round 1 (a guarded select that is correct still draws the warning).
		const findings = [
			...conflicts.slice(0, 2).map((line) => `Hint: ${line}`),
			...(bounds.length ? [`Hint: ${bounds[0]} A select outside the declared range reads x; check the range unless a condition guards it.`] : []),
		];
		const hints = [...interfaces, ...findings, ...await lintFiles(rels, ctx.workspace)].slice(0, 3);
		if (hints.length > 0) text += `\n${hints.join("\n")}`;
		return { ok: true, text: text + registerText, files: rels };
	}
	if (lines.length === 0) return failed("Compile failed with no messages.");
	const shown = await withSource(lines.slice(0, SHOWN), rels, ctx.workspace, ctx.smallFileLines ?? 150, lines, 2 - interfaces.length);
	let text = `Compile failed, ${lines.length} message lines.\n${shown.join("\n")}`;
	const attribution = await failureLocation(lines, rels, ctx.workspace);
	if (attribution) text = `${attribution}\n${text}`;
	if (lines.length > SHOWN) text += `\n(${lines.length - SHOWN} more lines not shown)`;
	const remaining = 2 - interfaces.length - shown.filter(line => line.startsWith("Hint: ")).length;
	text += [...interfaces, ...(await lintFiles(rels, ctx.workspace)).slice(0, remaining)].map(hint => `\n${hint}`).join("");
	return fail(text + registerText);
}

const SOURCE_ECHOES = 3;

function location(message: string, workspace: string): { rel: string; line: number } | undefined {
	const match = /^(.+?):(\d+):/.exec(message);
	if (!match) return undefined;
	const name = match[1]!.replace(/\\/g, "/");
	const resolved = resolveInWorkspace(workspace, path.isAbsolute(name) ? path.relative(workspace, name) : name);
	return resolved.ok ? { rel: resolved.rel, line: Number(match[2]) } : undefined;
}

async function failureLocation(messages: string[], rels: string[], workspace: string): Promise<string | undefined> {
	const files = new Set<string>();
	for (const message of messages) {
		if (/\bwarning\b/i.test(message)) continue;
		const found = location(message, workspace);
		if (found) {
			if (!rels.includes(found.rel)) return undefined;
			files.add(found.rel);
		}
	}
	if (!files.size) return undefined;
	try {
		const kinds = await Promise.all(rels.map(async rel => ({ rel, tb: isTestbench(await fs.readFile(path.join(workspace, rel), "utf8")) })));
		if (!kinds.some(file => file.tb) || !kinds.some(file => !file.tb)) return undefined;
		const failing = kinds.filter(file => files.has(file.rel));
		if (failing.every(file => file.tb)) return `The design compiled; the errors are in the testbench ${failing.map(file => file.rel).join(", ")}. Fix only the testbench.`;
		if (failing.every(file => !file.tb)) return `The testbench compiled; the errors are in the design ${failing.map(file => file.rel).join(", ")}. Fix only the design.`;
	} catch { /* Advice must not change the compile result. */ }
	return undefined;
}

export async function interfaceHints(files: string[], ctx: ToolContext): Promise<string[]> {
	if (!ctx.specTexts?.size) return [];
	const hints = new Set<string>();
	for (const file of files) {
		if (!/\.(v|sv)$/i.test(file)) continue;
		const resolved = resolveInWorkspace(ctx.workspace, file);
		if (!resolved.ok) continue;
		try {
			const source = await fs.readFile(resolved.abs, "utf8");
			for (const spec of ctx.specTexts.values()) {
				for (const hint of checkInterface(spec, source)) hints.add(hint);
			}
		} catch { /* Advice must not change the tool outcome if a file disappears. */ }
	}
	return [...hints].slice(0, 2);
}

export async function lintFiles(files: string[], workspace: string): Promise<string[]> {
	const hints: string[] = [];
	for (const file of files) {
		const resolved = resolveInWorkspace(workspace, file);
		if (!resolved.ok) continue;
		try {
			hints.push(...lintVerilog(await fs.readFile(resolved.abs, "utf8")));
		} catch {
			// Lint advice must not change the tool outcome when a file disappears.
		}
	}
	return hints;
}

/**
 * Puts the offending source line under a message like `rtl/gain.v:45: syntax error`,
 * so the model can fix the right line without reading the file again.
 */
async function withSource(messages: string[], rels: string[], workspace: string, limit: number, allMessages: string[], maxHints: number): Promise<string[]> {
	const out: string[] = [];
	const seen = new Set<string>();
	const cache = new Map<string, string[]>();
	let hints = 0;
	for (const message of messages) {
		out.push(message);
		const found = location(message, workspace);
		if (!found || seen.size >= SOURCE_ECHOES) continue;
		const { rel, line: lineNo } = found;
		const key = `${rel}:${lineNo}`;
		if (!rels.includes(rel) || seen.has(key)) continue;
		let source = cache.get(rel);
		if (!source) {
			try {
				source = (await fs.readFile(path.join(workspace, rel), "utf8")).split(/\r?\n/);
			} catch {
				continue;
			}
			cache.set(rel, source);
		}
		const line = source[lineNo - 1];
		if (line === undefined || line.trim() === "") continue;
		seen.add(key);
		out.push(`    ${lineNo}| ${trimLine(line)}`);
		const hint = compileHint(message, line, source.slice(0, lineNo - 1).join("\n"), isTestbench(source.join("\n")));
		if (hint && hints < maxHints) {
			out.push(`Hint: ${hint}`);
			hints++;
		}
	}
	for (const message of allMessages) {
		const hint = diagnosticHint(message);
		if (hint && hints < maxHints && !out.includes(`Hint: ${hint}`)) {
			out.push(`Hint: ${hint}`);
			hints++;
		}
	}
	if (hints < maxHints && limit > 0) {
		for (const message of allMessages) {
			const match = /^(.+?):\d+:/.exec(message);
			if (!match) continue;
			const name = match[1]!.replace(/\\/g, "/");
			const resolved = resolveInWorkspace(workspace, path.isAbsolute(name) ? path.relative(workspace, name) : name);
			if (!resolved.ok) continue;
			try {
				const count = splitLines(await fs.readFile(resolved.abs, "utf8")).length;
				if (count <= limit) continue;
				out.push(`Hint: ${resolved.rel} has ${count} lines. Fix only the reported lines with replace_lines; do not rewrite the file.`);
				break;
			} catch { /* The compiler may name a file that is no longer available. */ }
		}
	}
	return out;
}

function compileHint(message: string, line: string, prefix: string, testbench: boolean): string | undefined {
	if (testbench) {
		if (/port .+ is not a port of/i.test(message)) return "connect only the ports of the design's module header; read the header again.";
		if (/^\s*(?:reg\b|wire\b|integer\b|localparam\b|parameter\b|signed\s*\[|local\s|logic\b|real\b)/.test(line) && insideBody(prefix)) return "in a testbench declare reg, wire, integer and localparam at module level. Inside a task only input lines come before begin.";
	}
	const diagnostic = diagnosticHint(message);
	if (diagnostic) return diagnostic;
	if (/syntax error/i.test(message) && /\d+\s*'s?[dh]\s*-/i.test(line)) return "a sized constant cannot contain a minus sign. Write the value as a plain signed decimal, for example -8192.";
	const rules: [RegExp, string][] = [
		[/is not a valid l-value/i, "only a reg can be assigned in an always block; a wire needs assign."],
		[/Unable to bind wire\/reg\/memory/i, "this name is not declared in this module."],
		[/Syntax in assignment statement l-value/i, "check the line above for a missing semicolon or end."],
	];
	for (const [pattern, hint] of rules) if (pattern.test(message)) return hint;
	if (/syntax error/i.test(message) && /^\s*(?:localparam|parameter|wire|reg|integer|genvar)\b/.test(line) && insideAlways(prefix)) return "declare localparam, parameter, wire, reg and integer at module level, before the always block.";
	return undefined;
}

function insideBody(text: string): boolean {
	const source = text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ");
	let subprogram = false;
	let procedural = false;
	let depth = 0;
	for (const token of source.match(/\b(?:task|function|endtask|endfunction|initial|always|begin|end)\b|;/g) ?? []) {
		if (token === "task" || token === "function") subprogram = true;
		else if (token === "endtask" || token === "endfunction") subprogram = false;
		else if (token === "initial" || token === "always") { procedural = true; depth = 0; }
		else if (procedural && token === "begin") depth++;
		else if (procedural && token === "end" && --depth <= 0) procedural = false;
		else if (procedural && token === ";" && depth === 0) procedural = false;
	}
	return subprogram || procedural;
}

function diagnosticHint(message: string): string | undefined {
	if (/Include file .+ not found/i.test(message)) return "do not use `include. Give every file to compile or run_sim in the files argument instead.";
	if (/concatenation operand.*has indefinite width/i.test(message)) return "inside { } every constant needs a size, for example 4'd14, not 14 or 'sd14.";
	return undefined;
}

function insideAlways(text: string): boolean {
	const clean = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").replace(/"(?:\\.|[^"\\])*"/g, " ");
	let active = false;
	let depth = 0;
	for (const token of clean.match(/\balways\b|\bbegin\b|\bend\b|;/g) ?? []) {
		if (token === "always") { active = true; depth = 0; }
		else if (active && token === "begin") depth++;
		else if (active && token === "end" && --depth <= 0) active = false;
		else if (active && token === ";" && depth === 0) active = false;
	}
	return active;
}

export const compile: ToolSpec = {
	name: "compile",
	summary: "Compile Verilog files and report errors.",
	args: [{ name: "files", type: "string", required: true, help: "files to compile, separated by spaces" }],
	async run(args, ctx) {
		const { ok, text } = await compileFiles(args.files, ctx);
		return { ok, text };
	},
};
