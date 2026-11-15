import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolSpec } from "../types.ts";
import { resolveInWorkspace } from "./paths.ts";
import { joinLines, splitLines } from "./util.ts";
import { protectedRefusal } from "./edit_policy.ts";

export const writeFile: ToolSpec = {
	name: "write_file",
	summary: "Create a file or replace its whole contents.",
	args: [{ name: "path", type: "string", required: true, help: "file to write" }],
	body: { help: "the complete new file contents" },
	async run(args, ctx) {
		const p = resolveInWorkspace(ctx.workspace, String(args.path ?? ""));
		if (!p.ok) return { ok: false, text: p.text };
		const refusal = protectedRefusal("write_file", args, ctx);
		if (refusal) return { ok: false, text: refusal };
		if (typeof args.content !== "string") {
			return { ok: false, text: "write_file needs the file contents after a --- line." };
		}

		// Collapse trailing blank lines so the file ends in exactly one newline.
		const lines = splitLines(args.content.replace(/\r\n?/g, "\n").replace(/\n+$/, "\n"));
		let existed = true;
		try {
			const st = await fs.stat(p.abs);
			if (st.isDirectory()) return { ok: false, text: `${p.rel} is a folder, not a file.` };
		} catch {
			existed = false;
		}
		try {
			await fs.mkdir(path.dirname(p.abs), { recursive: true });
			await fs.writeFile(p.abs, joinLines(lines), "utf8");
		} catch (err) {
			return { ok: false, text: `Could not write ${p.rel}: ${(err as Error).message}` };
		}
		return { ok: true, text: `${existed ? "Wrote" : "Created"} ${p.rel}, ${lines.length} lines.` };
	},
};
