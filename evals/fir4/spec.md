# Four-tap FIR

Write `rtl/fir4.v` with this exact header:

```verilog
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
```

Coefficients are signed Q7 integers: 64 means 0.5. At each rising edge with `in_valid` high, compute `sum = din*c0 + h1*c1 + h2*c2 + h3*c3`, where h1, h2 and h3 are the last three accepted samples, newest first. Use the coefficients present at this edge. Keep the full signed sum (at least 26 bits). Arithmetic-shift `sum >>> 7`, then saturate to [-32768, 32767]. Negative fractional results round toward minus infinity.

The output is registered exactly one clock after `in_valid`: inputs driven at a falling edge produce `dout` and `out_valid=1` at the immediately following rising edge. There is one registered stage, with no additional pipeline delay. Shift sample history only on valid inputs. When `in_valid` is low, hold `dout`, leave history unchanged and set `out_valid=0`.

Synchronous active-high reset has highest priority: clear all history, `dout` and `out_valid` at the rising edge, even if `in_valid` is high.

Worked example: with history h1=200, h2=-100, h3=50, din=400 and c0=64, c1=32, c2=-64, c3=0, sum=25600+6400+6400+0=38400. The output is 38400 >>> 7 = 300. The new history is 400, 200, -100.

Do not change `tb/tb_fir4.v`.
