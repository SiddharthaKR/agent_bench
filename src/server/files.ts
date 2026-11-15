import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ServerResponse } from "node:http";
import type { TreeNode } from "../shared/api.ts";
import { resolveInWorkspace } from "../tools/paths.ts";
import { HttpError, stringField } from "./responses.ts";

const skipped = new Set([".git", "node_modules", ".build", "runs", "__pycache__", "dist"]);

export async function projectFolder(value: unknown): Promise<string> {
	const folder = stringField(value, "Folder");
	if (!path.isAbsolute(folder)) throw new HttpError(400, "Folder must be an absolute path.");
	try {
		if ((await fs.stat(folder)).isDirectory()) return folder;
	} catch (error) {
		if (!isMissing(error)) throw error;
	}
	throw new HttpError(400, "Folder must be an existing folder.");
}

export function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

export async function readTree(folder: string): Promise<TreeNode[]> {
	let count = 0;
	async function walk(relative: string, depth: number): Promise<TreeNode[]> {
		if (depth >= 8 || count >= 5000) return [];
		const entries = (await fs.readdir(path.join(folder, relative), { withFileTypes: true }))
			.filter((entry) => !skipped.has(entry.name) && !entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile()))
			.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
		const nodes: TreeNode[] = [];
		for (const entry of entries) {
			if (count >= 5000) break;
			count++;
			const rel = relative ? `${relative}/${entry.name}` : entry.name;
			const node: TreeNode = { name: entry.name, path: rel };
			if (entry.isDirectory()) node.children = await walk(rel, depth + 1);
			nodes.push(node);
		}
		return nodes;
	}
	return walk("", 0);
}

export function filePath(folder: string, value: unknown): { abs: string; rel: string } {
	const result = resolveInWorkspace(folder, typeof value === "string" ? value : "");
	if (!result.ok) throw new HttpError(400, result.text);
	return result;
}

export async function readText(folder: string, value: unknown): Promise<{ text: string }> {
	const target = filePath(folder, value);
	const notText = () => new HttpError(400, `${String(value)} is not a text file the editor can open.`);
	try {
		const handle = await fs.open(target.abs, "r");
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw notText();
			const bytes = await handle.readFile();
			if (bytes.length > 2 * 1024 * 1024 || bytes.includes(0)) throw notText();
			return { text: bytes.toString("utf8").replace(/\r\n/g, "\n") };
		} finally { await handle.close(); }
	} catch (error) {
		if (isMissing(error)) throw new HttpError(404, `File not found: ${String(value)}`);
		throw error;
	}
}

export async function writeText(folder: string, value: unknown, text: unknown): Promise<void> {
	const target = filePath(folder, value);
	if (typeof text !== "string") throw new HttpError(400, "Text must be a string.");
	await fs.mkdir(path.dirname(target.abs), { recursive: true });
	await fs.writeFile(target.abs, text, "utf8");
}

const contentTypes: Record<string, string> = {
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
	".woff2": "font/woff2", ".map": "application/json; charset=utf-8",
};

function inside(root: string, target: string): boolean {
	const relative = path.relative(root, target);
	return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

export async function serveStatic(response: ServerResponse, pathname: string, webDir?: string): Promise<void> {
	const missing = () => {
		response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		response.end("Not found.");
	};
	if (!webDir) return missing();
	const root = path.resolve(webDir);
	const relative = pathname.replace(/\\/g, "/").replace(/^\/+/, "");
	let target = path.resolve(root, relative);
	if (!inside(root, target) || relative.split("/").includes("..")) return missing();
	try {
		let stat;
		try { stat = await fs.stat(target); }
		catch (error) { if (!isMissing(error)) throw error; }
		if ((!stat || !stat.isFile()) && path.extname(target) === "") {
			target = path.join(root, "index.html");
		} else if (!stat?.isFile()) return missing();
		const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
		if (!inside(realRoot, realTarget)) return missing();
		const bytes = await fs.readFile(realTarget);
		response.writeHead(200, { "content-type": contentTypes[path.extname(target).toLowerCase()] ?? "application/octet-stream" });
		response.end(bytes);
	} catch (error) {
		if (isMissing(error)) return missing();
		throw error;
	}
}
