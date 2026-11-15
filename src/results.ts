import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ResultRow } from "./shared/results.ts";

export async function appendResult(runsDir: string, row: ResultRow): Promise<void> {
	await mkdir(runsDir, { recursive: true });
	await appendFile(path.join(runsDir, "results.jsonl"), JSON.stringify(row) + "\n", "utf8");
}

function isResult(value: unknown): value is ResultRow {
	if (!value || typeof value !== "object") return false;
	const row = value as Record<string, unknown>;
	return ["when", "suite", "level", "server", "model", "setup", "verdict"].every((key) => typeof row[key] === "string")
		&& Number.isFinite(Date.parse(row.when as string))
		&& typeof row.pass === "boolean"
		&& ["toolCalls", "seconds"].every((key) => row[key] === null || (typeof row[key] === "number" && Number.isFinite(row[key]) && row[key] >= 0))
		&& (row.trace === null || typeof row.trace === "string");
}

export async function readResults(runsDir: string): Promise<ResultRow[]> {
	let text: string;
	try { text = await readFile(path.join(runsDir, "results.jsonl"), "utf8"); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const rows: ResultRow[] = [];
	for (const line of text.split(/\r?\n/)) {
		try {
			const value: unknown = JSON.parse(line);
			if (isResult(value)) rows.push(value);
		} catch { /* An interrupted append must not hide other results. */ }
	}
	return rows.sort((a, b) => Date.parse(b.when) - Date.parse(a.when)).slice(0, 2000);
}
