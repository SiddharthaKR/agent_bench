import { expect, it } from "vitest";
import { simHints } from "../src/tools/sim_hints.ts";

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
