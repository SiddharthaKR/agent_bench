import { describe, it, expect } from "vitest";
import { looksLikeTestbench, NO_TESTBENCH, protectedRefusal, taskWantsTestbench } from "../src/tools/edit_policy.ts";
import type { ToolContext } from "../src/types.ts";

const ctx = (extra: object) => ({ workspace: process.cwd(), ...extra }) as unknown as ToolContext & { protect?: string[]; noTestbench?: boolean };

describe("no testbench unless the task asks for one", () => {
	it("recognises testbench paths", () => {
		for (const p of ["tb/tb_gain.v", "tb_top.v", "rtl/tb_TopModule.sv", "testbench.sv", "gain_tb.v", "sim/x.v", "test/a.v", "top_test.sv"]) expect(looksLikeTestbench(p)).toBe(true);
		for (const p of ["rtl/gain.v", "rtl/TopModule.sv", "src/stb_filter.v", "rtl/attribute.v", "latest.v"]) expect(looksLikeTestbench(p)).toBe(false);
	});

	it("reads whether a task asks for a testbench", () => {
		expect(taskWantsTestbench("Read spec.md and write the module to rtl/TopModule.sv. Compile it and fix every error.")).toBe(false);
		expect(taskWantsTestbench("Write the design, then a self-checking testbench.")).toBe(true);
		expect(taskWantsTestbench("Then run run_sim with files: rtl/gain.v tb/tb_gain.v")).toBe(true);
		expect(taskWantsTestbench("Simulate it and report.")).toBe(true);
		expect(taskWantsTestbench("Fix the stub in rtl/stb.v")).toBe(false);
	});

	it("refuses to write a testbench when the task does not ask for one", () => {
		expect(protectedRefusal("write_file", { path: "testbench.sv" }, ctx({ noTestbench: true }))).toBe(NO_TESTBENCH);
		expect(protectedRefusal("replace_lines", { path: "tb/tb_x.v" }, ctx({ noTestbench: true }))).toBe(NO_TESTBENCH);
		expect(protectedRefusal("write_file", { path: "rtl/top.v" }, ctx({ noTestbench: true }))).toBeUndefined();
		expect(protectedRefusal("write_file", { path: "testbench.sv" }, ctx({ noTestbench: false }))).toBeUndefined();
		expect(protectedRefusal("write_file", { path: "testbench.sv" }, ctx({}))).toBeUndefined();
	});

	it("says a given testbench is protected before anything else", () => {
		expect(protectedRefusal("write_file", { path: "tb/tb_x.v" }, ctx({ noTestbench: true, protect: ["tb/tb_x.v"] }))).toContain("is given and must not be changed");
	});
});
