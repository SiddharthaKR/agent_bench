import { mkdtemp, rm, appendFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { appendResult, readResults } from "../src/results.ts";
import { parseResultArgs } from "../src/cli-result.ts";
import type { ResultRow } from "../src/shared/results.ts";

let dir: string;
const row: ResultRow = { when: "2026-11-15T01:00:00.000Z", suite: "H", level: "easy", server: "local", model: "m", setup: "agent", pass: true, verdict: "PASS", toolCalls: null, seconds: null, trace: null };
const args = ["--suite", "gain", "--level", "easy", "--server", "local", "--model", "m", "--setup", "workflow fpga-block", "--verdict", "PASS"];
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "results-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

it("creates the results folder and preserves rows as separate JSON lines", async () => {
	const nested = path.join(dir, "runs");
	expect(await readResults(nested)).toEqual([]);
	await appendResult(nested, row);
	await appendResult(nested, { ...row, when: "2026-11-16T01:00:00.000Z", verdict: "FAIL", pass: false });
	await appendFile(path.join(nested, "results.jsonl"), '\nbroken\nnull\n{}\n{"when":"bad"}\n');
	expect((await readResults(nested)).map((r) => r.verdict)).toEqual(["FAIL", "PASS"]);
});

it("sorts by time and limits results to the newest 2000 valid rows", async () => {
	const rows = Array.from({ length: 2003 }, (_, i) => ({ ...row, when: new Date(i * 1000).toISOString() }));
	await writeFile(path.join(dir, "results.jsonl"), rows.reverse().map((r) => JSON.stringify(r)).join("\n"));
	const actual = await readResults(dir);
	expect(actual).toHaveLength(2000);
	expect(actual[0]?.when).toBe(new Date(2002000).toISOString());
	expect(actual.at(-1)?.when).toBe(new Date(3000).toISOString());
});

it("parses required labels, optional metrics and a deterministic timestamp", () => {
	expect(parseResultArgs([...args, "--tool-calls", "12", "--seconds", "41.5", "--trace", "a path"], row.when)).toEqual({ ...row, when: row.when, suite: "gain", setup: "workflow fpga-block", toolCalls: 12, seconds: 41.5, trace: "a path" });
	const parsed = parseResultArgs(args);
	expect(Number.isFinite(Date.parse(parsed.when))).toBe(true);
	expect(parsed.toolCalls).toBeNull();
	for (const verdict of ["FAIL", "TIME", "NO_CANDIDATE", "JUDGE_ERROR", "pass"]) {
		expect(parseResultArgs([...args.slice(0, -1), verdict]).pass).toBe(false);
	}
});

it("rejects missing, unknown, duplicate and invalid metric arguments", () => {
	for (const invalid of [[], [...args, "--trace"], [...args, "--unknown", "x"], [...args, "--suite", "x"], [...args, "--seconds", "-1"], [...args, "--seconds", "NaN"], [...args, "--tool-calls", "1.5"], [...args, "--model", ""]]) {
		expect(() => parseResultArgs(invalid)).toThrow();
	}
});
