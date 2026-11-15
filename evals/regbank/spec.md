# regbank block

Write `rtl/regbank.v`.

```verilog
module regbank (
	input wire clk, rst, wr_en,
	input wire [1:0] wr_addr,
	input wire signed [11:0] wr_data,
	input wire [2:0] rd_addr,
	output reg signed [15:0] rd_data
);
```

All actions occur on rising clk edges. rst is synchronous active high with highest priority: signed 12-bit registers R0..R3 become 0,-1,2047,-2048 respectively and signed 16-bit rd_data becomes 0. Otherwise wr_en writes signed wr_data to the register selected by unsigned 2-bit wr_addr. Independently, every edge registers the pre-edge value selected by unsigned 3-bit rd_addr: addresses 0..3 read R0..R3 with sign extension from 12 to 16 bits; address 4 reads constant read-only status 16'hA501 (signed -23295); addresses 5..7 read zero. Writes cannot address or change status. Same-edge read/write of one register returns its old value. rd_data holds between edges. No parameters.

Example: after reset R1=-1. An edge with wr_en=1,wr_addr=1,wr_data=-12,rd_addr=1 produces rd_data=-1. The next edge with wr_en=0,rd_addr=1 produces -12.

The testbench is `tb/tb_regbank.v`. Do not change it.
