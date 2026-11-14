import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TraceEvent, TraceWriter } from "./types.ts";

const pad = (n: number): string => String(n).padStart(2, "0");

function stamp(now: Date): string {
	const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
	const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `${date}-${time}`;
}

function cleanLabel(label: string): string {
	return label.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

/** Creates `<rootDir>/<YYYYMMDD-HHMMSS>-<label>` and writes events to it. */
export function createTrace(rootDir: string, label: string, now: Date = new Date()): TraceWriter {
	const root = path.resolve(rootDir);
	mkdirSync(root, { recursive: true });
	const base = `${stamp(now)}-${cleanLabel(label)}`;

	let dir = path.join(root, base);
	for (let n = 2; ; n++) {
		try {
			mkdirSync(dir); // fails if it exists, so the choice is atomic
			break;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
			dir = path.join(root, `${base}-${n}`);
		}
	}

	const file = path.join(dir, "trace.jsonl");
	let count = 0;
	let closed = false;

	return {
		dir,
		write(event: TraceEvent): void {
			if (closed) return;
			try {
				const rest: Record<string, unknown> = { ...event };
				delete rest.n; // n and t are ours; drop any the event carries
				delete rest.t;
				const line = JSON.stringify({ n: count + 1, t: new Date().toISOString(), ...rest });
				appendFileSync(file, line + "\n");
				count++;
			} catch {
				// Tracing must never break a run.
			}
		},
		close(summary: Record<string, unknown>): void {
			if (closed) return;
			closed = true;
			try {
				const out = { ...summary, events: count };
				writeFileSync(path.join(dir, "summary.json"), JSON.stringify(out, null, "\t") + "\n");
			} catch {
				// Tracing must never break a run.
			}
		},
	};
}

/** A trace that records nothing and creates no files. */
export function nullTrace(): TraceWriter {
	return {
		dir: "",
		write(): void {},
		close(): void {},
	};
}
