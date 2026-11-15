---
name: fixed-point
description: Signed bit growth, rounding, saturation and register read-back.
always: false
---
A signed Wa by Wb multiply needs Wa+Wb bits. Adding two signed values needs max(Wa,Wb)+1 bits after aligning their binary points. Sign-extend operands before operating, and declare the destination signed and wide enough. Summing K terms can need ceil(log2(K)) extra bits.

Use >>> on a signed value for arithmetic right shift. Round half up by adding a positive half of the discarded unit before shifting: for shift S>0, add 2^(S-1) in a sufficiently wide signed temporary, then shift by S. This rounds ties toward positive infinity, including negative ties. For S=0, omit the addition. Allow another bit for rounding overflow.

Signed N-bit saturation limits are -2^(N-1) and 2^(N-1)-1. Compare the wide shifted result to sign-extended limits before narrowing; assign the limit when exceeded.

Example: signed 8-bit operands a and b, product shifted by 4, saturated to signed 8 bits. Declare all temporaries at module level:

```verilog
reg signed [15:0] product;
reg signed [16:0] rounded, scaled;
reg signed [7:0] y;
always @* begin
	product = $signed({{8{a[7]}}, a}) * $signed({{8{b[7]}}, b});
	rounded = $signed({product[15], product}) + 17'sd8;
	scaled = rounded >>> 3'd4;
	if (scaled > 17'sd127) y = 8'sd127;
	else if (scaled < -17'sd128) y = -8'sd128;
	else y = scaled[7:0];
end
```

For a signed N-bit register read through a wider W-bit bus, copy the sign bit into the upper W-N bits: {{(W-N){value[N-1]}}, value}. Reading into software requires the same sign extension. A zero-extended negative value becomes a positive integer; a slice also loses signedness in Verilog expressions.
