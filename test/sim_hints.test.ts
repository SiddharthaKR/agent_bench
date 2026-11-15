import { expect, it } from "vitest";
import { simHints } from "../src/tools/sim_hints.ts";

it("explains a repeated saturation value with differing wanted values", () => {
	expect(simHints(["FAIL a got 32767 wanted 1", "FAIL b got 32767 wanted -2", "FAIL c got 32767 wanted 3"])).toEqual(["Hint: every result is 32767. If that is a saturation limit, the comparison is probably unsigned or the limits are swapped; declare limits and compared values signed."]);
	for (const value of ["x", "z"]) expect(simHints([1, 2, 3].map((n) => `FAIL a got ${value} wanted ${n}`)).join("\n")).not.toContain("every result");
	expect(simHints([1, 2, 3].map(() => "FAIL a got 32767 wanted 1"))).toEqual([]);
});
it("recognizes hexadecimal constants and counts failing lines only", () => {
	expect(simHints([1, 2, 3].map((n) => `FAIL a got 0x7fff wanted ${n}`)).join("\n")).toContain("every result is 0x7fff");
	expect(simHints(["FAIL a got 99 wanted 1", "PASS b got 99 wanted 2", "PASS c got 99 wanted 3"])).toEqual([]);
});

it("recognizes the real late output and unknown value", () => {
	const hints = simHints(["FAIL unity got x wanted 160", "FAIL times_two got 160 wanted 200", "FAIL negative got 200 wanted -200", "FAIL saturate_neg got 32767 wanted -32768", "FAIL truncate got 32767 wanted 3"]);
	expect(hints).toHaveLength(2);
	expect(hints[0]).toContain("output is late");
	expect(hints[1]).toContain("Hint: x means");
});
it("recognizes a two-clock delay and punctuation case insensitively", () => {
	expect(simHints(["FAIL a GOT: 99 EXPECTED= 1", "FAIL b got= 88 wanted: 2", "FAIL c got 1 wanted 3", "FAIL d got 2 wanted 4"])[0]).toContain("output is late");
});
it.each(["x", "X", "z", "xzZX"])("recognizes unknown %s", (value) => {
	expect(simHints([`FAIL a got ${value} wanted 1`])).toHaveLength(1);
});
it("recognizes an unknown got value without an expected value", () => {
	expect(simHints(["FAIL reset got: x"])[0]).toContain("Hint: x means");
});
it("ignores unrelated failures and a single coincidental match", () => {
	expect(simHints(["FAIL a got 3 wanted 1", "FAIL b got 4 wanted 2", "FAIL c got 2 wanted 5"])).toEqual([]);
	expect(simHints(["FAIL no values", "FAIL a got 12 wanted 22"])).toEqual([]);
});
it("returns at most two hints", () => {
	expect(simHints(["FAIL a got x wanted 1", "FAIL b got 1 wanted 2", "FAIL c got 2 wanted 3", "FAIL d got z wanted 4", "FAIL e got 4 wanted 5"])).toHaveLength(2);
});
