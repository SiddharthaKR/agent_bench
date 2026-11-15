`timescale 1ns/1ps
module tb_pwm;
reg clk=0,rst=0;
always #5 clk=~clk;
integer failures=0;
integer started=0;
task check;
	input integer got,wanted;
	begin
		if(got !== wanted) begin $display("FAIL pwm got %0d wanted %0d",got,wanted); failures=failures+1; end
		else $display("PASS pwm");
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
	$display("FAIL pwm got %0d wanted %0d",-1,0);
	$display("1 TESTS FAILED"); $finish;
end
reg [7:0] duty=0;
wire pwm_out;
pwm dut(clk,rst,duty,pwm_out);
integer c=0,latched=0,i;
task step;
	input integer reset,value;
	begin
		@(negedge clk); rst=reset; duty=value;
		#1; if(started) begin check(pwm_out,c<latched); end
		started=1;
		@(posedge clk); #1;
		if(reset) begin c=0; latched=0; end
		else begin if(c==255) latched=value; c=(c+1)%256; end
		check(pwm_out,c<latched);
	end
endtask
initial begin
	step(1,255);
	for(i=0;i<256;i=i+1) step(0,2);
	for(i=0;i<256;i=i+1) step(0,255);
	for(i=0;i<256;i=i+1) step(0,0);
	for(i=0;i<256;i=i+1) step(0,128);
	for(i=0;i<30;i=i+1) step(0,i);
	step(1,200); step(0,200); finish_tests;
end
endmodule
