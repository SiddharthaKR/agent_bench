export function simHints(lines: string[]): string[] {
	const hints: string[] = [];
	const pairs = lines.flatMap((line) => {
		if (!/\b(?:FAIL|FAILED|ERROR|MISMATCH)\b/i.test(line)) return [];
		const match = /\bgot\b\s*[=:]?\s*(\S+)\s+(?:wanted|expected)\b\s*[=:]?\s*(\S+)/i.exec(line);
		return match ? [{ got: match[1]!.toLowerCase(), wanted: match[2]!.toLowerCase() }] : [];
	});
	const late = pairs.filter((pair, index) => [1, 2].some((offset) => index >= offset && pair.got === pairs[index - offset]!.wanted));
	if (late.length >= 2) hints.push("Hint: each result equals an earlier test's expected value, so the output is late by one or more clocks. Keep one registered stage: compute intermediate values with assign or in always @* using =, and assign only the output with <= in the clocked block.");
	if (lines.some((line) => /\bgot\b\s*[=:]?\s*[xz]+(?=\s|$)/i.test(line))) hints.push("Hint: x means a signal was read before it was assigned, has no driver, or has two drivers. Check reset and that every used signal is declared and driven once.");
	const failed = pairs.filter((pair) => !/^[xz]+$/i.test(pair.got));
	for (const value of new Set(failed.map((pair) => pair.got))) {
		const group = failed.filter((pair) => pair.got === value);
		if (group.length >= 3 && new Set(group.map((pair) => pair.wanted)).size > 1) {
			hints.push(`Hint: every result is ${value}. If that is a saturation limit, the comparison is probably unsigned or the limits are swapped; declare limits and compared values signed.`);
			break;
		}
	}
	return hints.slice(0, 2);
}
