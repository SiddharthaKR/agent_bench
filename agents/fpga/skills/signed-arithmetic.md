---
name: signed-arithmetic
description: Load when RTL mixes signed and unsigned operands, slices, concatenations or Q formats.
always: false
---
An arithmetic expression is signed only when all operands are signed. One unsigned operand makes the expression unsigned; widening then zero-extends signed operands too.

Unsigned by definition: based literals without s (8'd3, 'hFF), bit-selects, part-selects even from signed signals, concatenations and comparison results. Plain decimal integers, integer, signed declarations, 8'sd3 and $signed(...) are signed. $signed changes sign interpretation, not width. To treat an unsigned coefficient as positive signed, add a zero MSB before casting.

Assignment context can widen an expression before evaluation. With signed 16-bit a,b, a 32-bit destination makes a*b and (a*b) >>> 4 evaluate at 32 bits. A concatenation operand is self-determined: $signed(a*b) inside it can already have lost the upper product bits. Use a separately declared wide wire.

```verilog
module arithmetic_examples(input signed [15:0] a, b,
	input [7:0] coef);
	wire signed [31:0] p = a * b;
	wire signed [24:0] q = a * $signed({1'b0, coef});
	wire signed [16:0] s = a + b;
	wire signed [16:0] bad = a + 8'd1;
	wire signed [16:0] good = a + 17'sd1;
endmodule
```

The bad line zero-extends negative a before adding; the good line keeps signed math.

Qm.n uses m integer bits including sign and n fractional bits, total m+n. Qa.b times Qc.d gives Q(a+c).(b+d). For addition, align fractional bits first. Track each intermediate format and the number of fractional bits removed. Use fixed-point for bit growth, scaling, rounding and saturation details.

Common bugs to review:
- A product destination narrower than Wa+Wb.
- Signed data mixed with an unsigned slice or concatenation.
- Logical >> on negative data, or a slice missing $signed.
- Overflow checked after narrowing, or against the wrong upper bits.
- A concatenation with the wrong total bit count.
- An accumulator missing guard bits for its term count.
- Negation or abs of the most negative value without a wider result.
