import { describe, expect, it } from "vitest";
import type { TraceRow } from "../../../src/shared/trace.ts";
import { filterRows, formatElapsed, formatTokens, isTraceError } from "./logic.ts";

describe("trace formatting", () => {
	it("formats elapsed time as minutes and whole seconds", () => {
		expect(formatElapsed(72099)).toBe("1m 12s");
		expect(formatElapsed(0)).toBe("0m 0s");
		expect(formatElapsed(-1)).toBe("0m 0s");
		expect(formatElapsed(3600000)).toBe("60m 0s");
	});
	it("formats context tokens in thousands with one decimal", () => {
		expect(formatTokens(0)).toBe("0.0k");
		expect(formatTokens(12560)).toBe("12.6k");
	});
	it("filters errors and guards while preserving order", () => {
		const kinds: TraceRow["kind"][] = ["system", "user", "thinking", "tool call", "tool result", "tool error", "bad tool call", "reply", "guard", "error"];
		const rows = kinds.map((kind, id) => ({ kind, id: String(id), call: 1, direction: "sent" as const, title: "", text: "", meta: "", raw: null }));
		expect(filterRows(rows, false)).toBe(rows);
		expect(filterRows(rows, true).map((row) => row.kind)).toEqual(["tool error", "bad tool call", "guard", "error"]);
		expect(kinds.filter(isTraceError)).toEqual(["tool error", "bad tool call", "error"]);
		expect(filterRows([], true)).toEqual([]);
	});
});
