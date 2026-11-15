`timescale 1ns/1ps
module tb_fir4;
	reg clk = 0;
	reg rst = 0, in_valid = 0;
	reg signed [15:0] din = 0;
	reg signed [7:0] c0 = 0, c1 = 0, c2 = 0, c3 = 0;
	wire out_valid;
	wire signed [15:0] dout;
	integer fails = 0;
	fir4 dut (.clk(clk), .rst(rst), .in_valid(in_valid), .din(din), .c0(c0), .c1(c1), .c2(c2), .c3(c3), .out_valid(out_valid), .dout(dout));
	always #5 clk = ~clk;

	task check;
		input r, v;
		input signed [15:0] d;
		input signed [7:0] a, b, c, e;
		input signed [15:0] wanted;
		input valid;
		input [8*32:1] name;
		begin
			@(negedge clk); rst = r; in_valid = v; din = d; c0 = a; c1 = b; c2 = c; c3 = e;
			@(posedge clk); #1;
			if (dout === wanted) $display("PASS %0s_data", name);
			else begin $display("FAIL %0s_data got %0d wanted %0d", name, dout, wanted); fails = fails + 1; end
			if (out_valid === valid) $display("PASS %0s_valid", name);
			else begin $display("FAIL %0s_valid got %0d wanted %0d", name, out_valid, valid); fails = fails + 1; end
		end
	endtask

	initial begin
		check(1, 1, 999, 64, 64, 64, 64, 0, 0, "reset_priority");
		check(0, 1, 100, 64, 64, 64, 64, 50, 1, "first_sample");
		check(0, 1, 200, 64, 64, 64, 64, 150, 1, "second_sample");
		check(0, 0, 999, 127, 127, 127, 127, 150, 0, "valid_gap");
		check(0, 1, -100, 64, 64, 64, 64, 100, 1, "history_after_gap");
		check(0, 1, 400, 64, 64, 64, 64, 300, 1, "four_taps");
		check(0, 1, 0, 64, 64, 64, 64, 250, 1, "history_shifts");
		check(0, 1, 0, 0, 0, 0, -64, 50, 1, "negative_coefficient");
		check(1, 0, 0, 0, 0, 0, 0, 0, 0, "clear_history");
		check(0, 1, 32767, 127, 127, 127, 127, 32511, 1, "positive_full_scale");
		check(0, 1, 32767, 127, 127, 127, 127, 32767, 1, "saturate_pos");
		check(0, 1, 32767, 127, 127, 127, 127, 32767, 1, "wide_sum");
		check(0, 1, 32767, 127, 127, 127, 127, 32767, 1, "four_full_scale");
		check(1, 1, 32767, 127, 127, 127, 127, 0, 0, "reset_nonzero_history");
		check(0, 1, -32768, 127, 127, 127, 127, -32512, 1, "negative_full_scale");
		check(0, 1, -32768, 127, 127, 127, 127, -32768, 1, "saturate_neg");
		check(0, 1, -1, 1, 0, 0, 0, -1, 1, "negative_truncation");
		check(0, 0, 0, 0, 0, 0, 0, -1, 0, "hold_output");
		check(0, 0, 0, 0, 0, 0, 0, -1, 0, "second_gap");
		if (fails == 0) $display("ALL TESTS PASSED");
		else $display("%0d TESTS FAILED", fails);
		$finish;
	end
endmodule
