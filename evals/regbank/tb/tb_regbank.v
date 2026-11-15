`timescale 1ns/1ps
module tb_regbank;
reg clk=0,rst=0;
always #5 clk=~clk;
integer failures=0;
integer started=0;
task check;
	input integer got,wanted;
	begin
		if(got !== wanted) begin $display("FAIL regbank got %0d wanted %0d",got,wanted); failures=failures+1; end
		else $display("PASS regbank");
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
	$display("FAIL regbank got %0d wanted %0d",-1,0);
	$display("1 TESTS FAILED"); $finish;
end
reg wr_en=0;
reg [1:0] wr_addr=0;
reg signed [11:0] wr_data=0;
reg [2:0] rd_addr=0;
wire signed [15:0] rd_data;
regbank dut(clk,rst,wr_en,wr_addr,wr_data,rd_addr,rd_data);
integer r[0:3];
integer expected=0,i;
task step;
	input integer reset,we,wa,wd,ra;
	begin
		@(negedge clk); rst=reset; wr_en=we; wr_addr=wa; wr_data=wd; rd_addr=ra;
		#1; if(started) begin check($signed(rd_data),expected); end
		started=1;
		if(reset) begin r[0]=0; r[1]=-1; r[2]=2047; r[3]=-2048; expected=0; end
		else begin
			if(ra<4) expected=r[ra]; else if(ra==4) expected=-23295; else expected=0;
			if(we) r[wa]=wd;
		end
		@(posedge clk); #1; check($signed(rd_data),expected);
	end
endtask
initial begin
	step(1,1,0,123,4);
	for(i=0;i<8;i=i+1) step(0,0,0,0,i);
	for(i=0;i<4;i=i+1) begin step(0,1,i,-12-i,i); step(0,0,0,0,i); end
	step(0,1,2,2047,4); step(0,1,3,-2048,4);
	step(0,0,0,0,2); step(0,0,0,0,3);
	step(1,1,1,88,1); step(0,0,0,0,1); finish_tests;
end
endmodule
