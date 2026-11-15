import * as fs from "node:fs/promises";
import type { ToolSpec } from "../types.ts";
import { resolveInWorkspace } from "./paths.ts";
import { isNotFound, joinLines, lineNumber, numbered, splitLines } from "./util.ts";
import { protectedRefusal } from "./edit_policy.ts";
import { autofixVerilog } from "./autofix.ts";

const CONTEXT = 2;
const ECHO_CAP = 40;

export const replaceLines: ToolSpec = {
	name: "replace_lines",
	summary: "Replace lines from..to of a file (both included) with new text.",
	args: [
		{ name: "path", type: "string", required: true, help: "file to edit" },
		{ name: "from", type: "number", required: true, help: "first line to replace" },
		{ name: "to", type: "number", required: true, help: "last line to replace" },
	],
	body: { help: "the new lines; leave empty to delete the range" },
	async run(args, ctx) {
		const p = resolveInWorkspace(ctx.workspace, String(args.path ?? ""));
		if (!p.ok) return { ok: false, text: p.text };
		const refusal = protectedRefusal("replace_lines", args, ctx);
		if (refusal) return { ok: false, text: refusal };
		if (args.from === undefined) return { ok: false, text: "replace_lines needs from." };
		if (args.to === undefined) return { ok: false, text: "replace_lines needs to." };
		const f = lineNumber(args.from, "from");
		if (!f.ok) return { ok: false, text: f.text };
		const t = lineNumber(args.to, "to");
		if (!t.ok) return { ok: false, text: t.text };
		const from = f.value;
		const to = t.value;

		let lines: string[];
		try {
			if ((await fs.stat(p.abs)).isDirectory()) {
				return { ok: false, text: `${p.rel} is a folder, not a file.` };
			}
			lines = splitLines(await fs.readFile(p.abs, "utf8"));
		} catch (err) {
			if (isNotFound(err)) return { ok: false, text: `File not found: ${p.rel}` };
			return { ok: false, text: `Could not read ${p.rel}: ${(err as Error).message}` };
		}

		const count = lines.length;
		if (from > count) {
			return { ok: false, text: `${p.rel} has ${count} lines; from ${from} is past the end.` };
		}
		if (to > count) {
			return { ok: false, text: `${p.rel} has ${count} lines; to ${to} is past the end.` };
		}
		if (from > to) return { ok: false, text: `from ${from} is after to ${to}.` };

		const body = typeof args.content === "string" ? args.content : "";
		const added = body === "" ? [] : splitLines(body.endsWith("\n") || body.endsWith("\r") ? body : body + "\n");
		const combined = joinLines([...lines.slice(0, from - 1), ...added, ...lines.slice(to)]);
		const repaired = /\.(v|sv|vh|svh)$/i.test(p.rel) ? autofixVerilog(combined) : { text: combined, notes: [] };
		const next = splitLines(repaired.text);
		try {
			await fs.writeFile(p.abs, joinLines(next), "utf8");
		} catch (err) {
			return { ok: false, text: `Could not write ${p.rel}: ${(err as Error).message}` };
		}

		const first = Math.max(1, from - CONTEXT);
		const last = Math.min(next.length, from + added.length - 1 + CONTEXT);
		let echo = numbered(next.slice(first - 1, last), first);
		if (echo.length > ECHO_CAP) echo = [...echo.slice(0, 20), "...", ...echo.slice(-20)];

		const head = `Replaced lines ${from}-${to} of ${p.rel} with ${added.length} lines. File now has ${next.length} lines.`;
		return { ok: true, text: [head, ...echo, ...repaired.notes].join("\n") };
	},
};
