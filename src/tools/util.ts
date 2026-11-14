/** Shared helpers for the file tools. */

export type IntResult = { ok: true; value: number } | { ok: false; text: string };

/** Accepts a number or a numeric string; rejects anything that is not a whole number >= 1. */
export function lineNumber(value: unknown, name: string): IntResult {
	const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
	if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) {
		return { ok: false, text: `${name} must be a whole number, got ${String(value)}.` };
	}
	if (n < 1) return { ok: false, text: `${name} must be 1 or more, got ${n}.` };
	return { ok: true, value: n };
}

/** Splits file text into lines: CRLF becomes LF, one trailing newline is not an extra line. */
export function splitLines(text: string): string[] {
	const t = text.replace(/\r\n?/g, "\n");
	if (t === "") return [];
	return (t.endsWith("\n") ? t.slice(0, -1) : t).split("\n");
}

/** Lines to file text: LF endings, exactly one trailing newline. */
export function joinLines(lines: string[]): string {
	return lines.length === 0 ? "" : lines.join("\n") + "\n";
}

/** Formats lines as `<n>| <text>`, numbers right-aligned to the widest one. */
export function numbered(lines: string[], firstNumber: number): string[] {
	const width = String(firstNumber + lines.length - 1).length;
	return lines.map((l, i) => `${String(firstNumber + i).padStart(width)}| ${l}`);
}

export function isNotFound(err: unknown): boolean {
	return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

export function trimLine(line: string, max = 200): string {
	return line.length > max ? line.slice(0, max) : line;
}
