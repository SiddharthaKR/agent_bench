import { readFile } from "node:fs/promises";
import { resolveInWorkspace } from "./paths.ts";
import { splitLines } from "./util.ts";

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
