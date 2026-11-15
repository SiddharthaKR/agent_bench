---
name: testbench-template
description: Load when writing a self-checking Verilog testbench with directed checks and PASS or FAIL output.
always: false
---
Keep the testbench short: under 120 lines, 6 to 12 directed checks. Adapt this form; names, widths and the latency are an example.

```verilog
`timescale 1ns/1ps
module tb;
	reg clk = 0, rst = 1;
	reg signed [15:0] din = 0;
	wire signed [15:0] dout;
	integer errs = 0;
	always #5 clk = ~clk;
	dut u_dut (.clk(clk), .rst(rst), .din(din), .dout(dout));

	task check;                         // apply one input, wait the latency, compare
		input [8*24-1:0] name;
		input signed [15:0] value;
		input signed [15:0] wanted;
		begin
			@(negedge clk); din = value;
			repeat (1) @(negedge clk);  // latency in clocks, from the spec
			if (dout !== wanted) begin
				errs = errs + 1;
				$display("FAIL %0s got %0d wanted %0d", name, dout, wanted);
			end else $display("PASS %0s", name);
		end
	endtask

	initial begin
		repeat (3) @(negedge clk);
		rst = 0;
		check("zero", 0, 0);
		check("negative", -100, -100);
		check("max", 32767, 32767);
		if (errs == 0) $display("ALL TESTS PASSED");
		else $display("%0d TESTS FAILED", errs);
		$finish;
	end
	initial begin #200000; $display("FAIL timeout"); $finish; end
endmodule
```

For a register bus add one task per bus operation, in the same style, and follow the handshake in the spec exactly:

```verilog
	task bus_write;
		input [15:0] a;
		input [31:0] d;
		begin
			@(negedge clk); addr = a; wdata = d; wen = 1;
			@(negedge clk); wen = 0;
		end
	endtask
```

Rules:
- Declare every reg, wire and integer at module level. Inside a task only input lines come before begin. No declarations inside initial or always.
- Drive inputs on the falling edge; the design samples on the rising edge.
- Write values as plain decimals with the sign first (-8192). A sized constant cannot contain a minus sign.
- Work out each expected value from the arithmetic in the spec, step by step, before you write the check. A wrong expected value looks like a design bug.
- Cover: the reset value, zero, a positive and a negative case, saturation in both directions when the spec saturates, the smallest and largest setting, and read-back of every register.
- Check names are short words without spaces.
