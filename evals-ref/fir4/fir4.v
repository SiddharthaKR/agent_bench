module fir4 (
	input wire clk,
	input wire rst,
	input wire in_valid,
	input wire signed [15:0] din,
	input wire signed [7:0] c0,
	input wire signed [7:0] c1,
	input wire signed [7:0] c2,
	input wire signed [7:0] c3,
	output reg out_valid,
	output reg signed [15:0] dout
);
	reg signed [15:0] h1, h2, h3;
	wire signed [25:0] p0 = din * c0;
	wire signed [25:0] p1 = h1 * c1;
	wire signed [25:0] p2 = h2 * c2;
	wire signed [25:0] p3 = h3 * c3;
	wire signed [25:0] sum = p0 + p1 + p2 + p3;
	wire signed [25:0] scaled = sum >>> 7;
	always @(posedge clk) begin
		if (rst) begin
			h1 <= 0;
			h2 <= 0;
			h3 <= 0;
			dout <= 0;
			out_valid <= 0;
		end else begin
			out_valid <= in_valid;
			if (in_valid) begin
				h3 <= h2;
				h2 <= h1;
				h1 <= din;
				if (scaled > 32767) dout <= 16'sh7fff;
				else if (scaled < -32768) dout <= 16'sh8000;
				else dout <= scaled[15:0];
			end
		end
	end
endmodule
