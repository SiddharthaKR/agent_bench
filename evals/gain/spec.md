# gain block

Write `rtl/gain.v`.

```
module gain #(parameter W = 16) (
  input  wire                clk,
  input  wire                rst,   // synchronous, active high
  input  wire signed [W-1:0] din,
  input  wire signed [7:0]   k,     // gain in Q4 format: 16 means 1.0
  output reg  signed [W-1:0] dout
);
```

Behaviour, on every rising clock edge:
- if `rst` is high, `dout` becomes 0;
- otherwise `dout` becomes `(din * k) >>> 4` (arithmetic shift, so the result is truncated toward minus infinity), saturated to the signed W-bit range. A result above the largest value becomes the largest value; a result below the smallest value becomes the smallest value.

The output is registered: it appears one clock after the input.

The testbench is `tb/tb_gain.v`. Do not change it.
