---
name: testbench-template
description: Load when writing a self-checking clocked RTL testbench with latency alignment and PASS or FAIL output.
always: false
---
For a DUT with LAT >= 1 register stages, adapt this identity reference, ports and widths to the spec. exp_q[LAT-1] matches the sample taken LAT stages earlier. Replace model with independent reference behavior including specified rounding and overflow.

```verilog
`timescale 1ns/1ps
module tb;
	localparam W = 16, LAT = 2, N = 1000;
	reg clk = 0, rst = 1, valid_in = 0;
	reg signed [W-1:0] x = 0;
	wire signed [W-1:0] y;
	wire valid_out;
	reg signed [W-1:0] exp_q [0:LAT-1];
	reg [LAT-1:0] vld_q = 0;
	integer i, k, errs = 0, checks = 0, seed = 1;
	always #5 clk = ~clk;
	dut u_dut(.clk(clk), .rst(rst), .valid_in(valid_in),
		.x(x), .y(y), .valid_out(valid_out));
	function signed [W-1:0] model;
		input signed [W-1:0] v;
		begin model = v; end
	endfunction
	task check;
		input [127:0] name;
		input signed [W-1:0] got, wanted;
		begin
			checks = checks + 1;
			if (got !== wanted) begin
				errs = errs + 1;
				$display("FAIL %0s got %0d wanted %0d", name, got, wanted);
			end else $display("PASS %0s", name);
		end
	endtask
	always @(posedge clk) begin
		if (rst) vld_q <= 0;
		else begin
			exp_q[0] <= model(x);
			vld_q[0] <= valid_in;
			for (k = 1; k < LAT; k = k + 1) begin
				exp_q[k] <= exp_q[k-1];
				vld_q[k] <= vld_q[k-1];
			end
		end
	end
	always @(negedge clk) begin
		check("valid", valid_out, vld_q[LAT-1]);
		if (!rst && vld_q[LAT-1]) check("data", y, exp_q[LAT-1]);
	end
	initial begin
		repeat (5) @(negedge clk);
		#1 rst = 0;
		valid_in = 1;
		@(negedge clk); #1 x = 16'sh7fff;
		@(negedge clk); #1 x = 16'sh8000;
		for (i = 0; i < N; i = i + 1) begin
			@(negedge clk); #1 x = $random(seed);
		end
		@(negedge clk); #1 valid_in = 0;
		repeat (LAT+1) @(negedge clk);
		#1;
		if (errs == 0 && checks > 0) $display("ALL TESTS PASSED");
		else $display("%0d TESTS FAILED", errs);
		$finish;
	end
endmodule
```

Also cover zero, both signed limits, both saturation directions when applicable, sign flips, bubbles, reset mid-stream and back-to-back bus transfers. Drive away from sampling edges. Check valid even during bubbles. Add time and input diagnostics for mismatches. Break the DUT once to confirm FAIL. Enable waves only for debugging.
