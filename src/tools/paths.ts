import * as path from "node:path";

export type PathResult = { ok: true; abs: string; rel: string } | { ok: false; text: string };

/** Resolves a model-supplied relative path inside the workspace, or says why not. */
export function resolveInWorkspace(workspace: string, relPath: string): PathResult {
	const raw = typeof relPath === "string" ? relPath.trim() : "";
	if (raw === "") return { ok: false, text: "The path is empty." };
	const slashed = raw.split("\\").join("/");
	if (slashed.startsWith("/") || /^[a-zA-Z]:/.test(slashed) || path.isAbsolute(raw)) {
		return { ok: false, text: `Use a path relative to the project folder, not ${slashed}.` };
	}
	const abs = path.resolve(workspace, slashed);
	const rel = path.relative(workspace, abs);
	if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
		return { ok: false, text: `The path ${slashed} is outside the project folder.` };
	}
	return { ok: true, abs, rel: (rel === "" ? "." : rel).split(path.sep).join("/") };
}
