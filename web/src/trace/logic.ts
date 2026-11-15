import type { TraceRow } from "../../../src/shared/trace.ts";

export function formatElapsed(ms: number): string {
	const seconds = Math.floor(Math.max(0, ms) / 1000);
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatTokens(tokens: number): string {
	return `${(tokens / 1000).toFixed(1)}k`;
}

export function isTraceError(kind: TraceRow["kind"]): boolean {
	return kind === "tool error" || kind === "bad tool call" || kind === "error";
}

export function filterRows(rows: TraceRow[], errorsOnly: boolean): TraceRow[] {
	return errorsOnly ? rows.filter((row) => isTraceError(row.kind) || row.kind === "guard") : rows;
}
