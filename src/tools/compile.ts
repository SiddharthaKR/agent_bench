import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolContext, ToolOutput, ToolSpec } from "../types.ts";
import { resolveInWorkspace } from "./paths.ts";
import { trimLine } from "./util.ts";
import { lintVerilog } from "./lint.ts";

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
export async function compileFiles(filesArg: unknown, ctx: ToolContext): Promise<CompileOutcome> {
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
	const r = await ctx.exec(program, args, { cwd: ctx.workspace, timeoutMs: TIMEOUT_MS, signal: ctx.signal });
	if (r.notFound) return fail(`The compiler "${program}" is not installed on this machine.`);
	if (r.timedOut) return fail("Compile timed out after 60 s.");

	const lines = outputLines(r.stderr, r.stdout);
	if (r.code === 0) {
		let text = "Compiled, 0 errors.";
		if (lines.length > 0) text += ` ${lines.length} warning lines; first: ${lines[0]}`;
		const hints = await lintFiles(rels, ctx.workspace);
		if (hints.length > 0) text += `\n${hints.join("\n")}`;
		return { ok: true, text, files: rels };
	}
	if (lines.length === 0) return fail("Compile failed with no messages.");
	const shown = await withSource(lines.slice(0, SHOWN), rels, ctx.workspace);
	let text = `Compile failed, ${lines.length} message lines.\n${shown.join("\n")}`;
	if (lines.length > SHOWN) text += `\n(${lines.length - SHOWN} more lines not shown)`;
	return fail(text);
}

const SOURCE_ECHOES = 3;

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
async function withSource(messages: string[], rels: string[], workspace: string): Promise<string[]> {
	const out: string[] = [];
	const seen = new Set<string>();
	const cache = new Map<string, string[]>();
	let hints = 0;
	for (const message of messages) {
		out.push(message);
		const match = /^(.+?):(\d+):/.exec(message);
		if (!match || seen.size >= SOURCE_ECHOES) continue;
		const rel = (match[1] ?? "").split("\\").join("/");
		const lineNo = Number(match[2]);
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
		const hint = compileHint(message, line, source.slice(0, lineNo).join("\n"));
		if (hint && hints < 2) {
			out.push(`Hint: ${hint}`);
			hints++;
		}
	}
	return out;
}

function compileHint(message: string, line: string, prefix: string): string | undefined {
	if (/syntax error/i.test(message) && /\d+\s*'s?[dh]\s*-/i.test(line)) return "put the minus sign before the size: -16'sd32768, not 16'sd-32768.";
	const rules: [RegExp, string][] = [
		[/is not a valid l-value/i, "only a reg can be assigned in an always block; a wire needs assign."],
		[/Unable to bind wire\/reg\/memory/i, "this name is not declared in this module."],
		[/Syntax in assignment statement l-value/i, "check the line above for a missing semicolon or end."],
	];
	for (const [pattern, hint] of rules) if (pattern.test(message)) return hint;
	if (/syntax error/i.test(message) && /^\s*(?:localparam|parameter|wire|reg|integer|genvar)\b/.test(line) && insideAlways(prefix)) return "declare localparam, parameter, wire, reg and integer at module level, before the always block.";
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
