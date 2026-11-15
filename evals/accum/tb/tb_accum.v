`timescale 1ns/1ps
module tb_accum;
reg clk=0,rst=0;
always #5 clk=~clk;
integer failures=0;
integer started=0;
task check;
	input integer got,wanted;
	begin
		if(got !== wanted) begin $display("FAIL accum got %0d wanted %0d",got,wanted); failures=failures+1; end
		else $display("PASS accum");
	end
endtask
task finish_tests;
	begin
		if(failures==0) $display("ALL TESTS PASSED"); else $display("%0d TESTS FAILED",failures);
		$finish;
	end
endtask
initial begin
	#200000;
	$display("FAIL accum got %0d wanted %0d",-1,0);
	$display("1 TESTS FAILED"); $finish;
end
reg clear=0,in_valid=0;
reg signed [11:0] din=0;
wire signed [15:0] sum;
wire overflow;
accum dut(clk,rst,clear,in_valid,din,sum,overflow);
integer total=0,sticky=0,next_sum,i;
task step;
	input integer reset,clr,valid,value;
	begin
		@(negedge clk); rst=reset; clear=clr; in_valid=valid; din=value;
		#1; if(started) begin check($signed(sum),total); check(overflow,sticky); end
		started=1;
		if(reset || clr) begin total=0; sticky=0; end
		else if(valid) begin
			next_sum=total+value;
			if(next_sum>32767) begin total=32767; sticky=1; end
			else if(next_sum< -32768) begin total=-32768; sticky=1; end
			else total=next_sum;
		end
		@(posedge clk); #1; check($signed(sum),total); check(overflow,sticky);
	end
endtask
initial begin
	step(1,0,1,100);
	for(i=0;i<16;i=i+1) step(0,0,1,2047);
	step(0,0,1,15); step(0,0,1,1); step(0,0,0,-2048); step(0,0,1,-2);
	step(0,1,1,2047);
	for(i=0;i<16;i=i+1) step(0,0,1,-2048);
	step(0,0,1,-1); step(0,0,1,3); step(0,0,0,2047);
	step(0,1,1,-100); step(0,0,1,-7); step(1,1,1,10); finish_tests;
end
endmodule
