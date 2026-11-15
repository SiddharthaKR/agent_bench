# seqdet block

Write `rtl/seqdet.v`.

```verilog
module seqdet (
	input wire clk, rst, bit_in,
	output reg hit
);
```

At every rising clk edge sample bit_in. rst is synchronous active high with highest priority: clear all history and hit to zero. Otherwise set registered hit to 1 exactly when the four most recent non-reset samples, including this edge, are 1011, and to 0 otherwise. Fewer than four samples since reset cannot match. Retain overlaps. This is a registered Mealy detector: hit appears after the edge sampling the final 1, lasts one clock, and holds between edges regardless of bit_in. No parameters.

Example: samples 1,0,1,1,0,1,1 give hit 0,0,0,1,0,0,1. Reset discards a partial pattern.

The testbench is `tb/tb_seqdet.v`. Do not change it.
