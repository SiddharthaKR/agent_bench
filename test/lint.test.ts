import { describe, expect, it } from "vitest";
import { lintVerilog } from "../src/tools/lint.ts";

const undriven = "Hint: output dout is never assigned, so it reads x. Assign dout itself.";

describe("lintVerilog", () => {
	it("names the shadow register in a parameterized ANSI module", () => {
		expect(lintVerilog(`module gain #(parameter W = 16) (
			input wire clk, input wire rst, input wire signed [W-1:0] din,
			output reg signed [W-1:0] dout
		);
		reg signed [W-1:0] dout_reg;
		always @(posedge clk) begin
			if (rst) dout_reg <= {W{1'b0}};
			else dout_reg <= din;
		end
		endmodule`)).toEqual([`${undriven} You assign dout_reg instead; an output reg is already a register, so drop dout_reg and assign dout.`]);
	});
	it.each([
		"module m(output reg dout); endmodule",
		"module m(dout); output reg dout; endmodule",
		"module m(output reg dout); always @* if (dout <= 3) $display(dout); endmodule",
		"module m(output reg dout); // dout = 1;\n/* assign dout = 0; */ endmodule",
		"module m(output reg dout); wire x; assign x = dout <= 3; endmodule",
		"module m(output reg dout); always @* if ((dout == 0) || (dout != 1 && dout >= 2)) $display(dout); endmodule",
		"module m(output reg dout); child c(.result(dout_reg)); endmodule",
		"module m(output reg dout); initial $display(\"dout = 1;\"); endmodule",
	])("reports an undriven output in %s", (source) => {
		expect(lintVerilog(source)).toEqual([undriven]);
	});
	it.each([
		"assign dout = a;",
		"always @(posedge clk) dout <= a;",
		"always @* dout = a;",
		"always @* for (integer i = 0; i < 4; i = i + 1) dout[i] = a;",
		"assign dout[3:0] = a;",
		"always @* dout[0] <= a;",
		"assign {other, dout[1:0]} = a;",
		"assign {{dout[0], other}, dout[1]} = a;",
		"child c(.result(dout));",
		"child c(.result({other, dout[0]}));",
		"always @* if (a != 0 && a >= 1 && a == 2) dout <= a;",
	])("recognizes a driver: %s", (body) => {
		expect(lintVerilog(`module m(input a, output reg [3:0] dout); ${body} endmodule`)).toEqual([]);
	});
	it("recognizes output declaration initializers", () => {
		expect(lintVerilog("module m(input a, b, output wire y = a & b, z = a); endmodule")).toEqual([]);
		expect(lintVerilog("module m(y); output wire y = 1; endmodule")).toEqual([]);
	});
	it("collects multiple names without collecting inputs or ranges", () => {
		expect(lintVerilog("module m(output logic signed [W-1:0] a, b, input c, output d); assign b = c; endmodule")).toEqual([
			"Hint: output a is never assigned, so it reads x. Assign a itself.",
			"Hint: output d is never assigned, so it reads x. Assign d itself.",
		]);
		expect(lintVerilog("module m(a, b); output reg [3:0] a, b; assign a = 1; endmodule")).toEqual([
			"Hint: output b is never assigned, so it reads x. Assign b itself.",
		]);
	});
	it("ignores testbenches and keeps module drivers separate", () => {
		expect(lintVerilog("module tb; reg dout; endmodule module empty(); endmodule")).toEqual([]);
		expect(lintVerilog("module a(output reg dout); endmodule module b(output reg dout); always @* dout = 1; endmodule")).toEqual([undriven]);
	});
	it("returns at most three hints", () => {
		expect(lintVerilog("module m(output a, b, c, d); endmodule")).toHaveLength(3);
	});
});
