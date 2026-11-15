module counter (
	input wire clk,
	input wire rst,
	input wire load,
	input wire [7:0] din,
	input wire en,
	input wire up,
	output reg [7:0] count,
	output reg wrap
);
	always @(posedge clk) begin
		wrap <= 0;
		if (rst) count <= 0;
		else if (load) count <= din;
		else if (en) begin
			if (up) begin
				count <= count + 1'b1;
				wrap <= (count == 255);
			end else begin
				count <= count - 1'b1;
				wrap <= (count == 0);
			end
		end
	end
endmodule
