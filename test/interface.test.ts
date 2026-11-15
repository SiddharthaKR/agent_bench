import { describe, expect, it } from "vitest";
import { checkInterface, specHeaders } from "../src/tools/interface.ts";

const spec = (header: string) => "```verilog\n" + header + "\n```";
const header = "module m(input signed [13:0] a, b, output [W-1:0] y);";

describe("spec interfaces", () => {
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
