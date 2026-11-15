module regbank (
	input wire clk, rst, wr_en,
	input wire [1:0] wr_addr,
	input wire signed [11:0] wr_data,
	input wire [2:0] rd_addr,
	output reg signed [15:0] rd_data
);
reg signed [11:0] regs[0:3];
always @(posedge clk) begin
	if(rst) begin regs[0]<=0; regs[1]<=-1; regs[2]<=2047; regs[3]<=-2048; rd_data<=0; end
	else begin
		if(wr_en) regs[wr_addr]<=wr_data;
		case(rd_addr)
			0,1,2,3: rd_data <= {{4{regs[rd_addr][11]}},regs[rd_addr]};
			4: rd_data<=16'hA501;
			default: rd_data<=0;
		endcase
	end
end
endmodule
