module uart_tx #(parameter BAUD_DIV = 4) (
	input wire clk, rst, start,
	input wire [7:0] data,
	output reg tx, busy
);
reg [7:0] captured;
integer ticks,bit_index;
always @(posedge clk) begin
	if(rst) begin tx<=1; busy<=0; ticks<=0; bit_index<=0; captured<=0; end
	else if(!busy) begin
		tx<=1;
		if(start) begin captured<=data; tx<=0; busy<=1; ticks<=0; bit_index<=0; end
	end
	else if(ticks==BAUD_DIV-1) begin
		ticks<=0;
		if(bit_index==9) begin busy<=0; tx<=1; end
		else begin
			bit_index<=bit_index+1;
			if(bit_index==8) tx<=1; else tx<=captured[bit_index];
		end
	end
	else ticks<=ticks+1;
end
endmodule
