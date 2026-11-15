`timescale 1ns/1ps
module tb_uart_tx;
reg clk=0,rst=0;
always #5 clk=~clk;
integer failures=0;
integer started=0;
task check;
	input integer got,wanted;
	begin
		if(got !== wanted) begin $display("FAIL uart_tx got %0d wanted %0d",got,wanted); failures=failures+1; end
		else $display("PASS uart_tx");
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
	$display("FAIL uart_tx got %0d wanted %0d",-1,0);
	$display("1 TESTS FAILED"); $finish;
end
reg start=0;
reg [7:0] data=0;
wire tx,busy;
parameter DIV=3;
uart_tx #(.BAUD_DIV(DIV)) dut(clk,rst,start,data,tx,busy);
integer active=0,age=0,payload=0,expected_tx=1,i;
task step;
	input integer reset,request,value;
	begin
		@(negedge clk); rst=reset; start=request; data=value;
		#1; if(started) begin check(tx,expected_tx); check(busy,active); end
		started=1;
		if(reset) begin active=0; age=0; expected_tx=1; end
		else if(active) begin
			age=age+1;
			if(age==10*DIV) begin active=0; expected_tx=1; end
			else if(age<DIV) expected_tx=0;
			else if(age<9*DIV) expected_tx=(payload >> (age/DIV-1))&1;
			else expected_tx=1;
		end
		else if(request) begin active=1; age=0; payload=value; expected_tx=0; end
		@(posedge clk); #1; check(tx,expected_tx); check(busy,active);
	end
endtask
task frame;
	input integer value;
	begin
		step(0,1,value);
		for(i=1;i<=10*DIV;i=i+1) step(0,1,255-value);
		step(0,0,0);
	end
endtask
initial begin
	step(1,1,255); step(0,0,0);
	frame(8'h96); frame(0); frame(255); frame(1); frame(128);
	step(0,1,55); step(0,0,0); step(1,1,255); step(0,0,0);
	step(0,1,66);
	for(i=1;i<=10*DIV+2;i=i+1) step(0,1,77);
	step(1,0,0); finish_tests;
end
endmodule
