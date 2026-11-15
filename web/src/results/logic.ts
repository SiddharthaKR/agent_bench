import type { ResultRow } from "../../../src/shared/results.ts";

export interface ResultFilters { suite: string; level: string; model: string; }
export interface ResultSummary {
	suite: string;
	level: string;
	model: string;
	setup: string;
	passed: number;
	total: number;
}

export function filterOptions(rows: ResultRow[], key: keyof ResultFilters): string[] {
	return [...new Set(rows.map((row) => row[key]))].sort((a, b) => a.localeCompare(b));
}

export function filterResults(rows: ResultRow[], filters: ResultFilters): ResultRow[] {
	return rows.filter((row) => (!filters.suite || row.suite === filters.suite) && (!filters.level || row.level === filters.level) && (!filters.model || row.model === filters.model));
}

export function summarizeResults(rows: ResultRow[]): ResultSummary[] {
	const groups = new Map<string, ResultSummary>();
	for (const row of rows) {
		const key = JSON.stringify([row.suite, row.level, row.model, row.setup]);
		const group = groups.get(key) ?? { suite: row.suite, level: row.level, model: row.model, setup: row.setup, passed: 0, total: 0 };
		group.total++;
		if (row.pass) group.passed++;
		groups.set(key, group);
	}
	return [...groups.values()].sort((a, b) => a.suite.localeCompare(b.suite) || a.level.localeCompare(b.level) || b.passed / b.total - a.passed / a.total || a.model.localeCompare(b.model) || a.setup.localeCompare(b.setup));
}

export function formatSeconds(seconds: number | null): string {
	if (seconds === null) return "—";
	const whole = Math.round(seconds);
	return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}m ${whole % 60}s`;
}
