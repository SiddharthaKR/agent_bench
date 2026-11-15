# accum block

Write `rtl/accum.v`.

```verilog
module accum (
	input wire clk, rst, clear, in_valid,
	input wire signed [11:0] din,
	output reg signed [15:0] sum,
	output reg overflow
);
```

All outputs change on rising clk edges only. rst is synchronous active high with highest priority, setting sum=0,overflow=0. clear has next priority and also sets both to zero, ignoring in_valid and din. Otherwise if in_valid=1, add signed 12-bit din to signed 16-bit sum with sufficient precision. Clamp above 32767 to 32767 and below -32768 to -32768. Equality to a limit is not overflow. Registered overflow sets on an out-of-range addition and stays set until clear or rst. Saturation does not freeze sum: subsequent opposite-sign inputs move it toward zero. With in_valid=0 both outputs hold. No parameters.

Example: sum=32760, valid din=10 gives sum=32767,overflow=1. Next valid din=-2 gives 32765,1. clear=1 on the next edge gives 0,0 even with valid input.

The testbench is `tb/tb_accum.v`. Do not change it.
