module seqdet (
	input wire clk, rst, bit_in,
	output reg hit
);
reg [3:0] history;
always @(posedge clk) begin
	if(rst) begin history<=0; hit<=0; end
	else begin history<={history[2:0],bit_in}; hit<={history[2:0],bit_in}==4'b1011; end
end
endmodule
