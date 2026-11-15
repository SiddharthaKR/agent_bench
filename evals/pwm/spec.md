# pwm block

Write `rtl/pwm.v`.

```verilog
module pwm (
	input wire clk, rst,
	input wire [7:0] duty,
	output wire pwm_out
);
```

All state changes on rising clk edges. rst is synchronous active high with highest priority, setting the internal unsigned 8-bit counter and latched duty to zero. Otherwise the counter increments modulo 256. When its pre-edge value is 255, capture unsigned duty. pwm_out is continuously counter < latched duty using current state. Changes to duty between wraps have no effect. No parameters.

Example: after reset, 255 non-reset edges leave counter=255, output=0. With duty=2 at the next edge, counter becomes 0 and output=1. Next edge counter=1, output=1; next counter=2, output=0. duty=0 is always low; duty=255 is high for counts 0..254.

The testbench is `tb/tb_pwm.v`. Do not change it.
