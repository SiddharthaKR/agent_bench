`timescale 1ns/1ps
module tb_counter;
	reg clk = 0;
	reg rst = 0, load = 0, en = 0, up = 0;
	reg [7:0] din = 0;
	wire [7:0] count;
	wire wrap;
	integer fails = 0;
	counter dut (.clk(clk), .rst(rst), .load(load), .din(din), .en(en), .up(up), .count(count), .wrap(wrap));
	always #5 clk = ~clk;

	task check;
		input r, l, e, u;
		input [7:0] d, wanted;
		input w;
		input [8*32:1] name;
		begin
			@(negedge clk); rst = r; load = l; en = e; up = u; din = d;
			@(posedge clk); #1;
			if (count === wanted) $display("PASS %0s_count", name);
			else begin $display("FAIL %0s_count got %0d wanted %0d", name, count, wanted); fails = fails + 1; end
			if (wrap === w) $display("PASS %0s_wrap", name);
			else begin $display("FAIL %0s_wrap got %0d wanted %0d", name, wrap, w); fails = fails + 1; end
		end
	endtask

	initial begin
		check(1, 1, 1, 1, 99, 0, 0, "reset_priority");
		check(0, 0, 1, 1, 0, 1, 0, "increment");
		check(0, 0, 0, 1, 0, 1, 0, "hold");
		check(0, 1, 1, 1, 255, 255, 0, "load_priority");
		check(0, 0, 1, 1, 0, 0, 1, "wrap_up");
		check(0, 0, 1, 1, 0, 1, 0, "wrap_pulse");
		check(0, 1, 0, 0, 0, 0, 0, "load_zero");
		check(0, 0, 1, 0, 0, 255, 1, "wrap_down");
		check(0, 0, 0, 0, 0, 255, 0, "disabled_clears_wrap");
		check(0, 0, 1, 0, 0, 254, 0, "decrement");
		check(0, 1, 1, 0, 42, 42, 0, "load_down_priority");
		check(1, 0, 1, 0, 0, 0, 0, "reset_again");
		if (fails == 0) $display("ALL TESTS PASSED");
		else $display("%0d TESTS FAILED", fails);
		$finish;
	end
endmodule
