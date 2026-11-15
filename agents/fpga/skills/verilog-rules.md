---
name: verilog-rules
description: Reliable synthesizable Verilog-2001 and Icarus testbenches.
always: true
---
Use exactly the module name and the ports the spec gives: the same names, directions and widths, and nothing added. If the spec lists no clock, the module is combinational: use assign or always @*, with no registers and no reset.
In a concatenation the first item is the most significant: "a, b, c followed by two 1 bits" is {a, b, c, 2'b11}.

Declare every wire, reg, integer and localparam at module level, before use, never inside always.
Use non-blocking <= in clocked blocks and blocking = in combinational blocks.
Give combinational outputs defaults and assign every path to avoid latches.
Use always @* for combinational logic. Give each reg exactly one driver.

Size and sign every constant, for example 16'sd5 or 1'b0. A sized constant cannot contain a minus sign: write a negative value as a plain decimal, -8192, never 14'sd-8192. Use localparam for named constants; a limit that is compared with a signed value must be declared signed, for example localparam signed [13:0] MIN = -8192.
Declare signed operands and results signed on both sides of arithmetic. Part-selects and concatenations are unsigned; cast them when needed.
Widen operands before multiplication or addition. Compare the wide result against signed limits, then assign the appropriate limit on overflow. Never implement saturation by slicing away overflow bits.

Latency: every reg assigned with <= in a clocked block adds one clock of delay. When the output must appear one clock after the input, the output reg is the only <= stage: compute every intermediate value with wire and assign (or in always @* with =), then register only the final result.
An output reg port is already a register: assign it directly. Never add a second register such as y_reg or y_next_reg for the same value and leave the port unassigned.
>>> on a signed value keeps the sign; >> does not.

Follow the specified reset, handshake and cycle latency. Keep testbench delays out of synthesizable logic.
Drive testbench inputs away from the active clock edge. For each check, print $display("PASS name") or $display("FAIL name ..."). End with $finish.
Compile after edits, simulate the testbench, and read failures before claiming success.
