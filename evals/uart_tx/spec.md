# uart_tx block

Write `rtl/uart_tx.v`.

```verilog
module uart_tx #(parameter BAUD_DIV = 4) (
	input wire clk, rst, start,
	input wire [7:0] data,
	output reg tx, busy
);
```

clk is the rising-edge clock. rst is synchronous active high with highest priority, aborting frames and setting tx=1,busy=0. Integer parameter BAUD_DIV >=1 (default 4) specifies clocks per bit. When pre-edge busy=0, start=1 captures unsigned data and immediately sets tx=0,busy=1 for the start bit. Each bit lasts exactly BAUD_DIV rising-edge intervals: start=0, eight captured data bits LSB first, then stop=1 (8N1, no parity). busy stays 1 for all ten bit intervals and becomes 0,tx=1 exactly 10*BAUD_DIV edges after acceptance. start while busy is ignored, including on the completion edge, with no queued request. Idle tx stays high. Held start is accepted on the first subsequent edge with pre-edge busy=0. data changes while busy have no effect.

Example BAUD_DIV=2: acceptance at E sets tx=0. E+2 starts data bit 0, E+4 bit 1, E+16 bit 7, E+18 stop, E+20 clears busy. Earliest next acceptance is E+21.

The testbench is `tb/tb_uart_tx.v`. Do not change it.
