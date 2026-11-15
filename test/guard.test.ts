import { describe, expect, it } from "vitest";
import { LoopGuard, signature } from "../src/guard.ts";

describe("unchanged check results", () => {
	it("tracks failures independently of calls and repeats the hint from the third failure", () => {
		const guard = new LoopGuard();
		const compile = { name: "compile", args: {} };
		expect(guard.noteResult(compile, false, "broken")).toBeUndefined();
		guard.noteResult({ name: "read_file", args: {} }, true, "file");
		expect(guard.noteResult(compile, false, "broken")).toBeUndefined();
		guard.noteResult({ name: "run_sim", args: {} }, false, "different");
		expect(guard.noteResult(compile, false, "broken")).toContain("Same result 3 times.");
		expect(guard.noteResult(compile, false, "broken")).toContain("write_file.");
		expect(guard.noteResult(compile, false, "changed")).toBeUndefined();
		guard.noteResult(compile, false, "changed");
		expect(guard.noteResult(compile, true, "changed")).toBeUndefined();
		expect(guard.noteResult(compile, false, "changed")).toBeUndefined();
	});
	it("uses configurable check names", () => {
		const guard = new LoopGuard({ checkTools: ["lint"] });
		for (let index = 0; index < 4; index++) expect(guard.noteResult({ name: "compile", args: {} }, false, "same")).toBeUndefined();
		guard.noteResult({ name: "lint", args: {} }, false, "same");
		guard.noteResult({ name: "lint", args: {} }, false, "same");
		expect(guard.noteResult({ name: "lint", args: {} }, false, "same")).toContain("Same result");
	});
});
import type { GuardCall } from "../src/types.ts";

const call = (name: string, args: Record<string, string | number> = {}): GuardCall => ({ name, args });
const A = call("read_file", { path: "a.txt" });
const B = call("list_dir", { path: "." });
const C = call("run", { cmd: "test" });

describe("signature", () => {
	it("ignores key order", () => {
		expect(signature(call("t", { a: "1", b: 2 }))).toBe(signature(call("t", { b: 2, a: "1" })));
	});

	it("changes with any value or name", () => {
		expect(signature(call("t", { a: "1" }))).not.toBe(signature(call("t", { a: "2" })));
		expect(signature(call("t", { a: "1" }))).not.toBe(signature(call("u", { a: "1" })));
	});

	it("hashes long values", () => {
		const big = "x".repeat(10000);
		const other = "y".repeat(10000);
		const sig = signature(call("write_file", { content: big }));
		expect(sig.length).toBeLessThan(400);
		expect(sig).not.toBe(signature(call("write_file", { content: other })));
	});
});

describe("LoopGuard", () => {
	it("allows two identical calls and blocks the third", () => {
		const g = new LoopGuard();
		expect(g.check(A)).toEqual({ allow: true });
		expect(g.check(A)).toEqual({ allow: true });
		const v = g.check(A);
		expect(v).toEqual({
			allow: false,
			reason: "Blocked: you made this exact call 2 times in a row and nothing changed. Do something different.",
			stop: false,
		});
	});

	it("a different call in between resets the run", () => {
		const g = new LoopGuard({ maxBlocks: 10 });
		g.check(A);
		g.check(A);
		g.check(B);
		expect(g.check(A).allow).toBe(true);
	});

	it("never blocks write_file with different content by repetition", () => {
		const g = new LoopGuard({ maxBlocks: 10 });
		for (let i = 0; i < 10; i++) {
			expect(g.check(call("write_file", { path: "x", content: `version ${i}` })).allow).toBe(true);
		}
		expect(g.blocked).toBe(0);
	});

	it("blocks a two-step cycle on the sixth call", () => {
		const g = new LoopGuard({ maxBlocks: 10 });
		for (let i = 1; i <= 5; i++) {
			expect(g.check(i % 2 === 1 ? A : B).allow).toBe(true);
		}
		expect(g.check(B)).toEqual({
			allow: false,
			reason: "Blocked: you are repeating the same 2 steps in a loop. Do something different.",
			stop: false,
		});
	});

	it("blocks a three-step cycle on the ninth call", () => {
		const g = new LoopGuard({ maxBlocks: 10 });
		const cycle = [A, B, C];
		for (let i = 0; i < 8; i++) {
			expect(g.check(cycle[i % 3]!).allow).toBe(true);
		}
		const v = g.check(C);
		expect(v.allow).toBe(false);
		expect(v).toMatchObject({ reason: "Blocked: you are repeating the same 3 steps in a loop. Do something different." });
	});

	it("stops after maxBlocks blocks", () => {
		const g = new LoopGuard({ maxBlocks: 2 });
		g.check(A);
		g.check(A);
		const first = g.check(A);
		expect(first).toMatchObject({ allow: false, stop: false });
		const second = g.check(A);
		expect(second).toEqual({
			allow: false,
			reason: "Stopped: blocked 2 times for repeating the same steps.",
			stop: true,
		});
		expect(g.blocked).toBe(2);
	});

	it("stops at the call limit", () => {
		const g = new LoopGuard({ maxCalls: 3 });
		expect(g.check(call("a", { i: 1 })).allow).toBe(true);
		expect(g.check(call("b", { i: 2 })).allow).toBe(true);
		expect(g.check(call("c", { i: 3 })).allow).toBe(true);
		expect(g.check(call("d", { i: 4 }))).toEqual({
			allow: false,
			reason: "Stopped: the limit of 3 tool calls was reached.",
			stop: true,
		});
		expect(g.allowed).toBe(3);
	});

	it("counts allowed and blocked calls", () => {
		const g = new LoopGuard();
		g.check(A);
		g.check(A);
		g.check(A);
		g.check(B);
		expect(g.allowed).toBe(3);
		expect(g.blocked).toBe(1);
	});

	it("respects maxRepeats", () => {
		const g = new LoopGuard({ maxRepeats: 3, maxBlocks: 10 });
		expect(g.check(A).allow).toBe(true);
		expect(g.check(A).allow).toBe(true);
		expect(g.check(A).allow).toBe(true);
		expect(g.check(A)).toMatchObject({
			allow: false,
			reason: "Blocked: you made this exact call 3 times in a row and nothing changed. Do something different.",
		});
	});
});
