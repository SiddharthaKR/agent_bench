import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTrace, nullTrace } from "../src/trace.ts";

let root: string;

beforeEach(() => {
	root = mkdtempSync(path.join(os.tmpdir(), "trace-test-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

const noon = new Date(2026, 0, 2, 9, 5, 7); // local time

describe("createTrace", () => {
	it("names the folder by local time and sanitised label", () => {
		const t = createTrace(root, "My Run!/x", noon);
		expect(path.basename(t.dir)).toBe("20260102-090507-my-run--x");
		expect(path.isAbsolute(t.dir)).toBe(true);
		expect(existsSync(t.dir)).toBe(true);
	});

	it("adds -2 when the folder already exists", () => {
		const first = createTrace(root, "run", noon);
		const second = createTrace(root, "run", noon);
		const third = createTrace(root, "run", noon);
		expect(path.basename(first.dir)).toBe("20260102-090507-run");
		expect(path.basename(second.dir)).toBe("20260102-090507-run-2");
		expect(path.basename(third.dir)).toBe("20260102-090507-run-3");
	});

	it("writes one parseable line per event with increasing n and a t", () => {
		const t = createTrace(root, "w", noon);
		t.write({ type: "a", value: 1 });
		t.write({ type: "b" });
		const lines = readFileSync(path.join(t.dir, "trace.jsonl"), "utf8").trimEnd().split("\n");
		expect(lines).toHaveLength(2);
		const [first, second] = lines.map((l) => JSON.parse(l));
		expect(first).toMatchObject({ n: 1, type: "a", value: 1 });
		expect(second).toMatchObject({ n: 2, type: "b" });
		expect(typeof first.t).toBe("string");
		expect(Number.isNaN(Date.parse(first.t))).toBe(false);
	});

	it("keeps newlines and quotes on one line", () => {
		const t = createTrace(root, "esc", noon);
		t.write({ type: "text", body: 'line one\nline "two"\r\nthree' });
		const raw = readFileSync(path.join(t.dir, "trace.jsonl"), "utf8");
		expect(raw.trimEnd().split("\n")).toHaveLength(1);
		expect(JSON.parse(raw).body).toBe('line one\nline "two"\r\nthree');
	});

	it("writes summary.json with the summary and event count", () => {
		const t = createTrace(root, "sum", noon);
		t.write({ type: "a" });
		t.write({ type: "b" });
		t.close({ outcome: "done", calls: 4 });
		const raw = readFileSync(path.join(t.dir, "summary.json"), "utf8");
		expect(raw.endsWith("\n")).toBe(true);
		expect(raw).toContain("\n\t");
		expect(JSON.parse(raw)).toEqual({ outcome: "done", calls: 4, events: 2 });
	});

	it("adds nothing after close", () => {
		const t = createTrace(root, "closed", noon);
		t.write({ type: "a" });
		t.close({ outcome: "done" });
		t.write({ type: "late" });
		const lines = readFileSync(path.join(t.dir, "trace.jsonl"), "utf8").trimEnd().split("\n");
		expect(lines).toHaveLength(1);
		expect(JSON.parse(readFileSync(path.join(t.dir, "summary.json"), "utf8")).events).toBe(1);
	});
});

describe("nullTrace", () => {
	it("does nothing and creates no files", () => {
		const t = nullTrace();
		expect(t.dir).toBe("");
		expect(() => {
			t.write({ type: "a" });
			t.close({ outcome: "done" });
		}).not.toThrow();
		expect(existsSync(root)).toBe(true);
		expect(readdirSync(root)).toEqual([]);
	});
});
