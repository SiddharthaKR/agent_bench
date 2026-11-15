# Up/down counter

Write `rtl/counter.v` with this exact header:

```verilog
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
```

On each rising clock edge, apply priority reset > load > enable:

- Synchronous active-high `rst` sets `count` and `wrap` to zero.
- Otherwise, `load` sets `count` to `din` and clears `wrap`, even when `en` is high.
- Otherwise, when `en` is high, increment if `up` is high or decrement if it is low. Arithmetic is modulo 256. Set `wrap` to one for the cycle immediately following an increment from 255 to 0 or a decrement from 0 to 255.
- When disabled, hold `count` and clear `wrap`. On every non-wrapping clock, clear `wrap`.

Both outputs are registered and reflect the inputs at the rising edge just completed. Do not add another clock of delay. Do not change `tb/tb_counter.v`.
