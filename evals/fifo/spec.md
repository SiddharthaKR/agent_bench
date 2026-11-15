# fifo block

Write `rtl/fifo.v`.

```verilog
module fifo (
	input wire clk, rst, wr_en, rd_en,
	input wire [7:0] din,
	output reg [7:0] dout,
	output wire full, empty,
	output reg [3:0] count
);
```

All transfers occur on rising clk edges. rst is synchronous active high with highest priority: count=0,dout=0 and both internal pointers=0; memory need not reset. Unsigned count is occupancy 0..8; full continuously means count==8 and empty means count==0. On non-reset edges a write is accepted iff wr_en && !full and a read iff rd_en && !empty, using pre-edge flags independently. Writes enqueue unsigned 8-bit din; reads remove the oldest byte and register it in dout. dout holds without accepted reads. count increases for write only, decreases for read only, holds for both or neither. Capacity is 8 and ordering is first in, first out. No parameters.

At full with both strobes only the read is accepted (count becomes 7), discarding the write. At empty with both only the write is accepted (count becomes 1), and dout holds: no bypass. Example: empty with dout=0, both strobes and din=42 produces count=1,dout=0. The next read-only edge produces count=0,dout=42.

The testbench is `tb/tb_fifo.v`. Do not change it.
