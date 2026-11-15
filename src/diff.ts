import type { DiffLine } from "./shared/api.ts";

/**
 * Line diff of two texts, for showing a proposed change. Returns only the
 * changed lines plus `context` unchanged lines around each change.
 */
export function lineDiff(before: string, after: string, context = 3): DiffLine[] {
	const a = splitLines(before);
	const b = splitLines(after);

	// Common start and end are skipped so the table below stays small.
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}

	const n = endA - start;
	const m = endB - start;
	// lcs[i][j] = length of the longest common subsequence of a[start+i..] and b[start+j..]
	const width = m + 1;
	const lcs = new Uint32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i * width + j] =
				a[start + i] === b[start + j]
					? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
					: Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0);
		}
	}

	const all: DiffLine[] = [];
	for (let k = 0; k < start; k++) all.push({ kind: "same", text: a[k] ?? "", line: k + 1 });
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && a[start + i] === b[start + j]) {
			all.push({ kind: "same", text: a[start + i] ?? "", line: start + i + 1 });
			i++;
			j++;
		} else if (j < m && (i === n || (lcs[i * width + j + 1] ?? 0) > (lcs[(i + 1) * width + j] ?? 0))) {
			all.push({ kind: "add", text: b[start + j] ?? "", line: start + j + 1 });
			j++;
		} else {
			all.push({ kind: "del", text: a[start + i] ?? "", line: start + i + 1 });
			i++;
		}
	}
	for (let k = endA; k < a.length; k++) all.push({ kind: "same", text: a[k] ?? "", line: k + 1 });

	// Keep changed lines and their neighbours only.
	const keep = new Array<boolean>(all.length).fill(false);
	all.forEach((line, index) => {
		if (line.kind === "same") return;
		for (let k = Math.max(0, index - context); k <= Math.min(all.length - 1, index + context); k++) keep[k] = true;
	});
	return all.filter((_, index) => keep[index]);
}

function splitLines(text: string): string[] {
	if (text === "") return [];
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}
