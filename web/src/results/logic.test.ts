import { expect, it } from "vitest";
import type { ResultRow } from "../../../src/shared/results.ts";
import { filterResults, summarizeResults, formatSeconds, filterOptions } from "./logic.ts";

const base: ResultRow = { when: "2026-11-15T00:00:00Z", suite: "H", level: "easy", server: "local", model: "m", setup: "agent", pass: true, verdict: "PASS", toolCalls: null, seconds: null, trace: null };
const rows = [base, { ...base, pass: false }, { ...base, setup: "workflow", model: "m2" }, { ...base, suite: "gain", level: "medium" }];
it("combines filters and provides distinct sorted filter options", () => {
	expect(filterResults(rows, { suite: "H", level: "easy", model: "m" })).toEqual(rows.slice(0, 2));
	expect(filterResults(rows, { suite: "", level: "", model: "" })).toEqual(rows);
	expect(filterOptions(rows, "model")).toEqual(["m", "m2"]);
});
it("groups all four dimensions, counts passes and orders by suite, level and rate", () => {
	const groups = summarizeResults(rows);
	expect(groups.map((g) => [g.suite, g.setup, g.passed, g.total])).toEqual([["gain", "agent", 1, 1], ["H", "workflow", 1, 1], ["H", "agent", 1, 2]]);
	expect(summarizeResults([])).toEqual([]);
	expect(summarizeResults([base, { ...base, model: "other" }])).toHaveLength(2);
});
it("formats missing, short and multi-minute times", () => {
	expect(formatSeconds(null)).toBe("—");
	expect(formatSeconds(0)).toBe("0s");
	expect(formatSeconds(72)).toBe("1m 12s");
	expect(formatSeconds(120)).toBe("2m 0s");
});
