import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkInterface, specHeaders } from "../src/tools/interface.ts";

const spec = (header: string) => "```verilog\n" + header + "\n```";
const header = "module m(input signed [13:0] a, b, output [W-1:0] y);";
const prose = "I would like a module named TopModule with the following interface.\n\n - input clk\n - input in (32 bits)\n - output out (32 bits)\n - output reg [7:0] q";

describe("spec interfaces", () => {
	it("reads the four ports in a prose interface", () => {
		expect(specHeaders(prose)).toMatchObject([{ name: "TopModule", ports: [
			{ direction: "input", name: "clk", range: "", signed: false },
			{ direction: "input", name: "in", range: "[31:0]", signed: false },
			{ direction: "output", name: "out", range: "[31:0]", signed: false },
			{ direction: "output", name: "q", range: "[7:0]", signed: false },
		] }]);
	});
	it("matches prose widths and reports renamed and added ports", () => {
		expect(checkInterface(prose, "module TopModule(input clk, input [32-1:0] in, output [31:0] out, output [8:1] q); endmodule")).toEqual([]);
		const hints = checkInterface(prose, "module TopModule(input clk, reset, clock, input in, output [31:0] out, output [7:0] q_out); endmodule");
		expect(hints).toHaveLength(1);
		expect(hints[0]).toContain("Missing: q. Extra: reset, clock, q_out.");
		expect(hints[0]).toContain("in (spec: input in (32 bits), file: input in)");
	});
	it("reads numbered ports, backticks, qualifiers and word widths", () => {
		const text = "Implement a module called `m`.\n1. input wire `a` (1 bit), a flag\n2. output logic signed `Q` (8-bit) trailing text\n3. inout reg [7:0] `bus`\n4. output ena [8 bits]";
		expect(specHeaders(text)[0]?.ports.map(port => [port.name, port.range, port.signed])).toEqual([
			["a", "[0:0]", false], ["Q", "[7:0]", true], ["bus", "[7:0]", false], ["ena", "[7:0]", false],
		]);
		expect(checkInterface(text, "module m(input signed a, output signed [8-1:0] Q, inout [7:0] bus, output [7:0] ena); endmodule")).toEqual([]);
		expect(checkInterface(text, "module m(input a, output [7:0] Q, inout [7:0] bus, output [7:0] ena); endmodule")[0]).toContain("Different: Q");
	});
	it("preserves bullet text in width hints", () => {
		expect(checkInterface("A module named m.\n* input a\n* output ena (3 bits)", "module m(input a, output ena); endmodule")[0]).toContain("ena (spec: output ena (3 bits), file: output ena)");
	});
	it("prefers a fenced header for the same module in either order", () => {
		const fenced = spec("module TopModule(input real_a, output real_q);");
		for (const text of [prose + "\n" + fenced, fenced + "\n" + prose]) expect(specHeaders(text)).toEqual(specHeaders(fenced));
	});
	it.each([
		"A module named m.\n- input a",
		"An interface.\n- input a\n- output b",
		"A module named m.\n- input a\nUnrelated text.\n- output b",
		"A module named m.\n- input a\n- unrelated item\n- output b",
		"```text\nA module named m.\n- input a\n- output b\n```",
	])("ignores incomplete or nonconsecutive prose interfaces: %s", text => {
		expect(specHeaders(text)).toEqual([]);
	});
	it.each([
		["accum", "input clk, rst, clear, in_valid, input signed [11:0] din, output signed [15:0] sum, output overflow"],
		["counter", "input clk, rst, load, input [7:0] din, input en, up, output [7:0] count, output wrap"],
		["fifo", "input clk, rst, wr_en, rd_en, input [7:0] din, output [7:0] dout, output full, empty, output [3:0] count"],
		["fir4", "input clk, rst, in_valid, input signed [15:0] din, input signed [7:0] c0, c1, c2, c3, output out_valid, output signed [15:0] dout"],
		["gain", "input clk, rst, input signed [W-1:0] din, input signed [7:0] k, output signed [W-1:0] dout"],
		["pwm", "input clk, rst, input [7:0] duty, output pwm_out"],
		["regbank", "input clk, rst, wr_en, input [1:0] wr_addr, input signed [11:0] wr_data, input [2:0] rd_addr, output signed [15:0] rd_data"],
		["seqdet", "input clk, rst, bit_in, output hit"],
		["uart_tx", "input clk, rst, start, input [7:0] data, output tx, busy"],
	])("keeps the existing %s eval interface", (name, ports) => {
		expect(specHeaders(readFileSync(`evals/${name}/spec.md`, "utf8"))).toEqual(specHeaders(spec(`module ${name}(${ports});`)));
	});
	it("reads several fenced headers without endmodule and ignores prose", () => {
		expect(specHeaders("module ignored(input x);\n" + spec(header + "\nmodule n(input clk);"))).toEqual([
			{ name: "m", ports: [{ direction: "input", signed: true, range: "[13:0]", name: "a" }, { direction: "input", signed: true, range: "[13:0]", name: "b" }, { direction: "output", signed: false, range: "[W-1:0]", name: "y" }] },
			{ name: "n", ports: [{ direction: "input", signed: false, range: "", name: "clk" }] },
		]);
	});
	it("ignores storage types, comments, order, whitespace and parameters", () => {
		expect(checkInterface(spec("module m #(parameter W=14)(input wire signed [14-1:0] a,b, output logic [W - 1:0] y);"), "module m #(parameter W=9)(output reg [ W-1 : 0 ] y, input /* port */ signed [13:0] b,a); endmodule")).toEqual([]);
	});
	it("evaluates integer arithmetic but keeps named expressions textual", () => {
		expect(checkInterface(spec("module m(input [(2+5)*2-1:0] a);"), "module m(input [13:0] a); endmodule")).toEqual([]);
		expect(checkInterface(spec("module m(input [W-1:0] a);"), "module m(input [W-2:0] a); endmodule")[0]).toContain("Different: a");
	});
	it("reports missing modules and limits output to two hints", () => {
		expect(checkInterface(spec("module a(input x); module b(input x); module c(input x);"), "module other(input x); endmodule")).toEqual([
			"Hint: the spec defines module a; this file defines other. Use the name from the spec.",
			"Hint: the spec defines module b; this file defines other. Use the name from the spec.",
		]);
	});
	it("reports missing, extra, direction, signedness and range differences", () => {
		expect(checkInterface(spec(header), "module m(output [13:0] a, input c, output [2:0] y); endmodule")).toEqual([
			"Hint: module m must keep the ports of the spec exactly. Missing: b. Extra: c. Different: a (spec: input signed [13:0], file: output [13:0]), y (spec: output [W-1:0], file: output [2:0]).",
		]);
		expect(checkInterface(spec("module m(input signed [13:0] a);"), "module m(input [13:0] a); endmodule")[0]).toContain("Different: a (spec: input signed [13:0], file: input [13:0]).");
	});
	it.each(["module m(a); input a; endmodule", "module m(input custom_t a); endmodule", "module m(input a", "module m(input a, a); endmodule", "/* unfinished comment\nmodule wrong(input a); endmodule"])("skips uncertain designs: %s", design => {
		expect(checkInterface(spec(header), design)).toEqual([]);
	});
	it("does not mistake comments or strings for headers", () => {
		expect(specHeaders(spec('// module fake(input x);\n/* module fake2(input x); */\nmodule m(input x);'))).toHaveLength(1);
		expect(checkInterface(spec("module m(input x);"), 'module m(input x); initial $display("module fake(input y);"); endmodule')).toEqual([]);
	});
	it("reads independent fences, including a longer closing fence", () => {
		expect(specHeaders("```sv\nmodule a(inout wire x);\n````\n\n~~~verilog\nmodule b(input y);\n~~~").map(header => header.name)).toEqual(["a", "b"]);
	});
});
