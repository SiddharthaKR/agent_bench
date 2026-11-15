module gain #(parameter W = 16) (
	input wire clk,
	input wire rst,
	input wire signed [W-1:0] din,
	input wire signed [7:0] k,
	output reg signed [W-1:0] dout
);
	localparam signed [W+7:0] MAXIMUM = (1 <<< (W-1)) - 1;
	localparam signed [W+7:0] MINIMUM = -(1 <<< (W-1));
	wire signed [W+7:0] product = din * k;
	wire signed [W+7:0] scaled = product >>> 4;
	always @(posedge clk) begin
		if (rst) dout <= 0;
		else if (scaled > MAXIMUM) dout <= MAXIMUM;
		else if (scaled < MINIMUM) dout <= MINIMUM;
		else dout <= scaled[W-1:0];
	end
endmodule
