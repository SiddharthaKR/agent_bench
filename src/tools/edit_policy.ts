import { readFile } from "node:fs/promises";
import { resolveInWorkspace } from "./paths.ts";
import { splitLines } from "./util.ts";
import type { ToolContext } from "../types.ts";

export type ProtectedContext = ToolContext & { protect?: string[] };

export function protectedRefusal(tool: string, args: Record<string, unknown>, ctx: ProtectedContext): string | undefined {
	if (tool !== "write_file" && tool !== "replace_lines") return undefined;
	const resolved = resolveInWorkspace(ctx.workspace, String(args.path ?? ""));
	if (!resolved.ok) return undefined;
	const fold = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
	const target = fold(resolved.rel);
	for (const entry of ctx.protect ?? []) {
		const given = resolveInWorkspace(ctx.workspace, entry);
		if (!given.ok) continue;
		const name = fold(given.rel);
		const folder = /[\\/]\s*$/.test(entry);
		if (target !== name && !(folder && (name === "." || target.startsWith(`${name}/`)))) continue;
		const testbench = /(?:^|\/)tb\//i.test(resolved.rel) || /^(?:tb_.*|.*_tb\.[^.]*)$/i.test(resolved.rel.split("/").at(-1) ?? "");
		return `${resolved.rel} is given and must not be changed.${testbench ? " Fix the design instead, and run run_sim with this file." : ""}`;
	}
	return undefined;
}

export async function smallFileRefusal(tool: string, args: Record<string, unknown>, workspace: string, limit = 150): Promise<string | undefined> {
	if (tool !== "replace_lines" || limit <= 0) return undefined;
	const resolved = resolveInWorkspace(workspace, String(args.path ?? ""));
	if (!resolved.ok) return undefined;
	try {
		const count = splitLines(await readFile(resolved.abs, "utf8")).length;
		if (count <= limit) return `${resolved.rel} has ${count} lines. For a file this small, read it and rewrite the whole file with write_file.`;
	} catch { /* The tool reports unreadable files. */ }
	return undefined;
}
