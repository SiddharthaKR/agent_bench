`timescale 1ns/1ps
module tb_seqdet;
reg clk=0,rst=0;
always #5 clk=~clk;
integer failures=0;
integer started=0;
task check;
	input integer got,wanted;
	begin
		if(got !== wanted) begin $display("FAIL seqdet got %0d wanted %0d",got,wanted); failures=failures+1; end
		else $display("PASS seqdet");
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
	$display("FAIL seqdet got %0d wanted %0d",-1,0);
	$display("1 TESTS FAILED"); $finish;
end
reg bit_in=0;
wire hit;
seqdet dut(clk,rst,bit_in,hit);
integer history=0,samples=0,i;
reg [31:0] stream=32'b10110110111101011011000101101011;
task step;
	input integer reset,value;
	begin
		@(negedge clk); rst=reset; bit_in=value;
		#1; if(started) begin check(hit,samples>=4 && history==11); end
		started=1;
		@(posedge clk); #1;
		if(reset) begin history=0; samples=0; end
		else begin history=((history<<1)|value)&15; samples=samples+1; end
		check(hit,!reset && samples>=4 && history==11);
	end
endtask
initial begin
	step(1,1);
	for(i=31;i>=0;i=i-1) step(0,stream[i]);
	step(1,0); step(0,1); step(0,0); step(0,1); step(1,1); step(0,1);
	for(i=0;i<16;i=i+1) step(0,1);
	finish_tests;
end
endmodule
