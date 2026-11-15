`timescale 1ns/1ps
module tb_fifo;
reg clk=0,rst=0;
always #5 clk=~clk;
integer failures=0;
integer started=0;
task check;
	input integer got,wanted;
	begin
		if(got !== wanted) begin $display("FAIL fifo got %0d wanted %0d",got,wanted); failures=failures+1; end
		else $display("PASS fifo");
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
	$display("FAIL fifo got %0d wanted %0d",-1,0);
	$display("1 TESTS FAILED"); $finish;
end
reg wr_en=0,rd_en=0;
reg [7:0] din=0;
wire [7:0] dout;
wire full,empty;
wire [3:0] count;
fifo dut(clk,rst,wr_en,rd_en,din,dout,full,empty,count);
integer q[0:7];
integer size=0,head=0,tail=0,last=0,take_read,take_write,i;
task step;
	input integer reset,we,re,value;
	begin
		@(negedge clk); rst=reset; wr_en=we; rd_en=re; din=value;
		#1; if(started) begin check(count,size); check(full,size==8); check(empty,size==0); check(dout,last); end
		started=1;
		if(reset) begin size=0; head=0; tail=0; last=0; end
		else begin
			take_read=re && size>0; take_write=we && size<8;
			if(take_read) begin last=q[head]; head=(head+1)%8; end
			if(take_write) begin q[tail]=value; tail=(tail+1)%8; end
			size=size+take_write-take_read;
		end
		@(posedge clk); #1;
		check(count,size); check(full,size==8); check(empty,size==0); check(dout,last);
	end
endtask
initial begin
	step(1,1,1,55); step(0,0,1,0); step(0,1,1,42); step(0,0,1,0);
	for(i=0;i<8;i=i+1) step(0,1,0,10+i);
	step(0,1,0,99); step(0,1,1,100);
	for(i=0;i<20;i=i+1) step(0,1,1,50+i);
	for(i=0;i<9;i=i+1) step(0,0,1,0);
	step(0,1,0,255); step(1,1,1,123); step(0,0,1,0); finish_tests;
end
endmodule
