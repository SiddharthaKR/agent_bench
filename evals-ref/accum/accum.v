module accum (
	input wire clk, rst, clear, in_valid,
	input wire signed [11:0] din,
	output reg signed [15:0] sum,
	output reg overflow
);
wire signed [16:0] extended = {sum[15],sum} + {{5{din[11]}},din};
always @(posedge clk) begin
	if(rst || clear) begin sum<=0; overflow<=0; end
	else if(in_valid) begin
		if(extended>17'sd32767) begin sum<=16'sh7fff; overflow<=1; end
		else if(extended< -17'sd32768) begin sum<=16'sh8000; overflow<=1; end
		else sum<=extended[15:0];
	end
end
endmodule
