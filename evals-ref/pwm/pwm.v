module pwm (
	input wire clk, rst,
	input wire [7:0] duty,
	output wire pwm_out
);
reg [7:0] counter,latched;
assign pwm_out = counter < latched;
always @(posedge clk) begin
	if(rst) begin counter<=0; latched<=0; end
	else begin counter<=counter+1'b1; if(counter==255) latched<=duty; end
end
endmodule
