import * as fs from "node:fs/promises";
import type { ToolSpec } from "../types.ts";
import { resolveInWorkspace } from "./paths.ts";
import { isNotFound, lineNumber, numbered, splitLines } from "./util.ts";

const MAX_LINES = 200;

export const readFile: ToolSpec = {
	name: "read_file",
	summary: "Read a text file, with line numbers.",
	args: [
		{ name: "path", type: "string", required: true, help: "file to read" },
		{ name: "from", type: "number", required: false, help: "first line, default 1" },
		{ name: "to", type: "number", required: false, help: "last line" },
	],
	async run(args, ctx) {
		const p = resolveInWorkspace(ctx.workspace, String(args.path ?? ""));
		if (!p.ok) return { ok: false, text: p.text };

		let from = 1;
		if (args.from !== undefined) {
			const f = lineNumber(args.from, "from");
			if (!f.ok) return { ok: false, text: f.text };
			from = f.value;
		}
		let to: number | undefined;
		if (args.to !== undefined) {
			const t = lineNumber(args.to, "to");
			if (!t.ok) return { ok: false, text: t.text };
			to = t.value;
		}
		if (to !== undefined && from > to) {
			return { ok: false, text: `from ${from} is after to ${to}.` };
		}

		let lines: string[];
		let source: string;
		try {
			if ((await fs.stat(p.abs)).isDirectory()) {
				return { ok: false, text: `${p.rel} is a folder, not a file.` };
			}
			source = await fs.readFile(p.abs, "utf8");
			lines = splitLines(source);
		} catch (err) {
			if (isNotFound(err)) return { ok: false, text: `File not found: ${p.rel}` };
			return { ok: false, text: `Could not read ${p.rel}: ${(err as Error).message}` };
		}

		const total = lines.length;
		if (total === 0) {
			if (/\.(md|txt)$/i.test(p.rel)) (ctx.specTexts ??= new Map()).set(p.rel, source);
			return { ok: true, text: `${p.rel} is empty (0 lines).` };
		}
		if (from > total) {
			return { ok: false, text: `${p.rel} has ${total} lines; from ${from} is past the end.` };
		}
		if (/\.(md|txt)$/i.test(p.rel)) (ctx.specTexts ??= new Map()).set(p.rel, source);

		const wanted = Math.min(to ?? total, total);
		const end = Math.min(wanted, from + MAX_LINES - 1);
		const shown = numbered(lines.slice(from - 1, end), from);
		let text = `${p.rel}, lines ${from}-${end} of ${total}\n${shown.join("\n")}`;
		if (end < wanted) {
			text += `\n(${wanted - end} more lines. Ask again with from: ${end + 1}.)`;
		}
		return { ok: true, text };
	},
};
