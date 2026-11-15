import { describe, expect, it } from "vitest";
import { readFile, readdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { qualityLint } from "../src/tools/lint.ts";
import { qualityReport } from "../src/tools/quality.ts";
import type { Exec } from "../src/types.ts";

const design = (body: string) => `module m(input clk, rst, a, b, output reg y); ${body} endmodule`;
const fixtures = [
	["latch", "always @* if(a) y=b;", "always @* begin y=0; if(a) y=b; end"],
	["blocking-in-clocked", "always @(posedge clk) y=a;", "always @(posedge clk) y<=a;"],
	["nonblocking-in-comb", "always @* y<=a;", "always @* y=a;"],
	["multi-driver", "always @* y=a; always @* y=b;", "always @* y=a;"],
	["sensitivity", "always @(a or b) y=a|b;", "always @(*) y=a|b;"],
	["delay-in-design", "assign #2 y=a;", "assign y=a;"],
	["initial-in-design", "initial y=0;", "assign y=a;"],
	["no-reset", "reg valid; always @(posedge clk) begin valid<=a; y<=a; end", "reg valid; always @(posedge clk) if(rst) begin valid<=0; y<=0; end else begin valid<=a; y<=a; end"],
	["undriven-output", "wire z=a;", "assign y=a;"],
	["unsigned-limit", "localparam [7:0] LIMIT=8'h80; wire signed [7:0] x; assign y=x>LIMIT ? 1 : 0;", "localparam signed [7:0] LIMIT=8'h80; wire signed [7:0] x; assign y=x>LIMIT ? 1 : 0;"],
	["width-literal", "assign y='h1;", "assign y=1'h1;"],
] as const;

describe("quality lint", () => {
	it.each(fixtures)("checks %s", (rule, bad, good) => {
		expect(qualityLint(design(bad)).some(f => f.rule === rule)).toBe(true);
		expect(qualityLint(design(good)).some(f => f.rule === rule)).toBe(false);
	});
	it("checks cases, else coverage, defaults and always_comb", () => {
		expect(qualityLint(design("always_comb case(a) 0: y=b; endcase")).map(f => f.rule)).toContain("latch");
		expect(qualityLint(design("always_comb begin y=0; case(a) 0: y=b; endcase end"))).toEqual([]);
		expect(qualityLint(design("always @* if(a) y=a; else y=b;"))).toEqual([]);
	});
	it("finds else-only latches and concatenated drivers", () => {
		expect(qualityLint(design("reg z; always_comb if(a) z=0; else y=b;")).some(f => f.rule === "latch" && f.message.startsWith("y "))).toBe(true);
		expect(qualityLint(design("reg z; always @* {z,y}={a,b}; always @(posedge clk) y<=a;")).some(f => f.rule === "multi-driver")).toBe(true);
	});
	it("does not absorb declarations after a complete always block", () => {
		expect(qualityLint(design("always @(posedge clk) begin y<=a; end wire z=1'b0;"))).toEqual([]);
		expect(qualityLint(design("always @(posedge clk) if(rst) y<=0; else y<=a; wire z=1'b0;"))).toEqual([]);
	});
	it("accepts a final unconditional combinational assignment", () => {
		expect(qualityLint(design("always_comb begin if(a) y=b; y=0; end"))).toEqual([]);
	});
	it("checks integer registers but ignores declared loop indices", () => {
		expect(qualityLint(design("integer count; always_ff @(posedge clk) begin count=0; y<=a; end")).some(f => f.rule === "blocking-in-clocked")).toBe(true);
	});
	it("preserves finding lines while stripping comments and strings", () => {
		const findings = qualityLint("/* ignored\ninitial #2 */\n" + design("\nalways_ff @(posedge clk) y=a;"));
		expect(findings.find(f => f.rule === "blocking-in-clocked")?.line).toBe(4);
	});
	it("reports more than three undriven outputs", () => {
		expect(qualityLint("module m(output a,b,c,d); endmodule")).toHaveLength(4);
	});
	it("does not guess drivers for custom port types or positional connections", () => {
		expect(qualityLint("typedef logic [3:0] word_t; module m(input word_t a, output word_t y); assign y=a; endmodule")).toEqual([]);
		expect(qualityLint("module m(input a, output y); child u(a,y); endmodule")).toEqual([]);
	});
	it("keeps block-local registers separate", () => {
		expect(qualityLint("module m(input a,b, output reg y,z); always_comb begin : A reg t; t=a; y=t; end always_comb begin : B reg t; t=b; z=t; end endmodule")).toEqual([]);
	});
	it("ignores comments, strings, comparisons and integer loop variables", () => {
		expect(qualityLint(design('integer i; always @(posedge clk) begin for(i=0;i<4;i=i+1) if(a<=b) y<=a; $display("#2 initial y=0;"); end // always @* y<=b;'))).toEqual([]);
	});
	it("keeps module drivers separate and does not treat parameters as delays", () => {
		expect(qualityLint(design("always @* y=a;") + "\n" + design("always @* y=b;"))).toEqual([]);
		expect(qualityLint("module tb; reg a; initial #2 a=0; endmodule").filter(f => f.severity === "error")).toEqual([]);
	});
	it("accepts all nine references", async () => {
		let count = 0;
		for (const name of await readdir("evals-ref")) {
			for (const file of await readdir(`evals-ref/${name}`)) {
				if (!file.endsWith(".v")) continue;
				expect(qualityLint(await readFile(`evals-ref/${name}/${file}`, "utf8")).filter(f => f.severity === "error"), name).toEqual([]);
				count++;
			}
		}
		expect(count).toBe(9);
	});
	it.each(["fixed-point", "pipelining", "reset-and-state"])("accepts code blocks in %s", async name => {
		const text = await readFile(`agents/fpga/skills/${name}.md`, "utf8");
		const blocks = [...text.matchAll(/```verilog\s*\n([\s\S]*?)```/g)];
		expect(blocks.length).toBeGreaterThan(0);
		for (const block of blocks) expect(qualityLint(block[1]!).filter(f => f.severity === "error")).toEqual([]);
	});
});

describe("quality report", () => {
	it("fails the interface rule with a spec file and accepts matching headers", async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), "quality-interface-"));
		try {
			await writeFile(path.join(cwd, "spec.md"), "```\nmodule m(input a, output y);\n```");
			await writeFile(path.join(cwd, "m.v"), "module m(input b, output y); assign y=b; endmodule");
			const exec: Exec = async () => ({ code: 0, stdout: "", stderr: "", timedOut: false, notFound: false });
			const options = { cwd, exec, commands: {}, print: () => {} };
			expect((await qualityReport(["m.v"], options)).pass).toBe(true);
			const report = await qualityReport(["m.v"], { ...options, spec: "spec.md" });
			expect(report.pass).toBe(false);
			expect(report.findings).toContainEqual(expect.objectContaining({ rule: "interface", severity: "error", file: "m.v" }));
			const cli = spawnSync(process.execPath, ["src/cli-quality.ts", "--spec", path.join(cwd, "spec.md"), path.join(cwd, "m.v")], { encoding: "utf8" });
			expect(cli.status, cli.stderr).toBe(1);
			expect(cli.stdout).toContain("interface:");
			await writeFile(path.join(cwd, "m.v"), "module m(input a, output y); assign y=a; endmodule");
			expect((await qualityReport(["m.v"], { ...options, spec: "spec.md" })).pass).toBe(true);
		} finally { await rm(cwd, { recursive: true, force: true }); }
	});
	it("uses repository configuration when no command override is supplied", async () => {
		const calls: string[] = [];
		const exec: Exec = async command => {
			calls.push(command);
			return { code: null, stdout: "", stderr: "", timedOut: false, notFound: true };
		};
		await qualityReport(["evals-ref/gain/gain.v"], { exec, print: () => {} });
		expect(calls).toContain("verilator");
		expect(calls).toContain("yosys");
	});
	it("keeps warnings without locations and classifies every failing Verilator code", async () => {
		const codes = ["LATCH", "MULTIDRIVEN", "BLKSEQ", "COMBDLY", "WIDTH", "UNDRIVEN", "CASEINCOMPLETE"];
		const exec: Exec = async command => ({ code: 0, stdout: "", stderr: command === "lint" ? codes.map(code => `%Warning-${code}: Warning without location`).join("\n") : "warning: Missing timescale", timedOut: false, notFound: false });
		const report = await qualityReport(["evals-ref/gain/gain.v"], { exec, commands: { lint: ["lint"] }, print: () => {} });
		expect(report.findings.filter(f => f.severity === "error").map(f => f.rule)).toEqual(codes.map(code => `verilator:${code}`));
		expect(report.findings.at(-1)?.rule).toBe("iverilog");
	});
	it("keeps notes nonfatal and expands paths as separate arguments", async () => {
		const calls: string[][] = [];
		const exec: Exec = async (command, args) => {
			calls.push([command, ...args]);
			return { code: 0, stdout: "", stderr: "%Warning-UNUSEDSIGNAL: x.v:2:1: Unused", timedOut: false, notFound: false };
		};
		const report = await qualityReport(["evals-ref/gain/gain.v", "evals-ref/counter/counter.v"], { exec, commands: { lint: ["lint", "{files}"], synth: [] }, print: () => {} });
		expect(report.pass).toBe(true);
		expect(calls[0]).toEqual(["lint", "evals-ref/gain/gain.v", "evals-ref/counter/counter.v"]);
		expect(calls[1]).toContain("-Wall");
	});
	it("skips absent tools and reports notes without failing", async () => {
		const exec: Exec = async () => ({ code: null, stdout: "", stderr: "", timedOut: false, notFound: true });
		const report = await qualityReport(["evals-ref/gain/gain.v"], { exec, commands: { lint: ["missing"], synth: ["missing"] } });
		expect(report.pass).toBe(true);
		expect(report.ran).toEqual([]);
		expect(report.text).toContain("QUALITY PASS");
	});
	it("classifies external warnings and synthesis errors", async () => {
		const exec: Exec = async command => ({ code: command === "synth" ? 1 : 0, stdout: "", stderr: command === "lint" ? "%Warning-WIDTH: x.v:3:2: Width mismatch\n%Warning-UNUSEDSIGNAL: x.v:4:2: Unused" : command === "synth" ? "ERROR: Cannot synthesize" : "x.v:5: warning: floating input", timedOut: false, notFound: false });
		const report = await qualityReport(["evals-ref/gain/gain.v"], { exec, commands: { lint: ["lint", "{files}"], synth: ["synth"] } });
		expect(report.pass).toBe(false);
		expect(report.findings.map(f => [f.rule, f.severity])).toEqual([["verilator:WIDTH", "error"], ["verilator:UNUSEDSIGNAL", "note"], ["synth", "error"], ["iverilog", "note"]]);
		expect(report.ran).toEqual(["verilator", "synth", "iverilog"]);
	});
});
