import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendResult } from "./results.ts";
import type { ResultRow } from "./shared/results.ts";

export function parseResultArgs(argv: string[], when = new Date().toISOString()): ResultRow & { task?: string } {
	const values: Record<string, string> = {};
	const required = ["suite", "level", "server", "model", "setup", "verdict"];
	const known = [...required, "tool-calls", "seconds", "trace", "task"];
	for (let i = 0; i < argv.length; i += 2) {
		const option = argv[i]!;
		const key = option.slice(2);
		if (!option.startsWith("--") || !known.includes(key)) throw new Error(`Unknown option ${option}.`);
		if (values[key] !== undefined) throw new Error(`Duplicate option ${option}.`);
		const value = argv[i + 1];
		if (!value?.trim() || value.startsWith("--")) throw new Error(`Option ${option} needs a value.`);
		values[key] = value;
	}
	for (const key of required) if (!values[key]) throw new Error(`Give --${key}.`);
	const metric = (key: string, integer: boolean): number | null => {
		if (values[key] === undefined) return null;
		const value = Number(values[key]);
		if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) throw new Error(`Invalid --${key}.`);
		return value;
	};
	return { when, suite: values.suite!, level: values.level!, server: values.server!, model: values.model!, setup: values.setup!, pass: values.verdict === "PASS", verdict: values.verdict!, toolCalls: metric("tool-calls", true), seconds: metric("seconds", false), trace: values.trace ?? null, ...(values.task === undefined ? {} : { task: values.task }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	Promise.resolve().then(() => appendResult(path.join(root, "runs"), parseResultArgs(process.argv.slice(2)))).catch((error: unknown) => {
		console.error((error as Error).message);
		process.exitCode = 1;
	});
}
