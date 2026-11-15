module fifo (
	input wire clk, rst, wr_en, rd_en,
	input wire [7:0] din,
	output reg [7:0] dout,
	output wire full, empty,
	output reg [3:0] count
);
reg [7:0] mem[0:7];
reg [2:0] head,tail;
wire take_read = rd_en && !empty;
wire take_write = wr_en && !full;
assign full=count==8;
assign empty=count==0;
always @(posedge clk) begin
	if(rst) begin head<=0; tail<=0; count<=0; dout<=0; end
	else begin
		if(take_write) begin mem[tail]<=din; tail<=tail+1'b1; end
		if(take_read) begin dout<=mem[head]; head<=head+1'b1; end
		case({take_write,take_read})
			2'b10: count<=count+1'b1;
			2'b01: count<=count-1'b1;
			default: count<=count;
		endcase
	end
end
endmodule
