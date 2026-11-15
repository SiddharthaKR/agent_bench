---
name: fixed-point
description: Signed bit growth, scaling, rounding, saturation and register read-back, with a worked module.
always: false
---
Bit growth: a signed Wa by Wb multiply needs Wa+Wb bits. Adding two signed values needs max(Wa,Wb)+1 bits after aligning their binary points; summing K terms needs ceil(log2(K)) extra bits. Declare operands and the destination signed and the destination wide enough; then Verilog sign-extends for you.

Scaling: >>> on a signed value is an arithmetic shift and truncates toward minus infinity. Use plain >>> unless the spec asks for rounding. Only when the spec asks to round half up by S bits: add 2^(S-1) in a temporary one bit wider, then shift by S.

Saturation: signed N-bit limits are -2^(N-1) and 2^(N-1)-1. Compare the wide scaled result with the limits, and only then narrow.

Worked module: registered multiply, scale by 2^4, saturate to W bits. Names and widths are an example; keep the structure. Intermediate values are wires, the output port is the only register and is assigned directly.

```verilog
module scale #(parameter W = 12) (
	input  wire                clk,
	input  wire                rst,
	input  wire signed [W-1:0] a,
	input  wire signed [5:0]   b,
	output reg  signed [W-1:0] y
);
	localparam signed [W-1:0] MAX = {1'b0, {(W-1){1'b1}}};
	localparam signed [W-1:0] MIN = {1'b1, {(W-1){1'b0}}};
	wire signed [W+5:0] prod   = a * b;       // W+6 bits, both operands signed
	wire signed [W+5:0] scaled = prod >>> 4;  // truncates
	always @(posedge clk) begin
		if (rst)               y <= {W{1'b0}};
		else if (scaled > MAX) y <= MAX;
		else if (scaled < MIN) y <= MIN;
		else                   y <= scaled[W-1:0];
	end
endmodule
```

For a signed N-bit register read through a wider W-bit bus, copy the sign bit into the upper W-N bits: {{(W-N){value[N-1]}}, value}. A zero-extended negative value becomes a positive number; a slice also loses signedness in Verilog expressions.
