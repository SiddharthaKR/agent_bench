---
name: verilog-rules
description: Reliable synthesizable Verilog-2001 and Icarus testbenches.
always: true
---
Declare every wire and reg at module level, before use, never inside always.
Use non-blocking <= in clocked blocks and blocking = in combinational blocks.
Give combinational outputs defaults and assign every path to avoid latches.
Use always @* for combinational logic. Give each reg exactly one driver.

Size and sign every constant, for example 16'sd5 or 1'b0. Use localparam for named constants.
Declare signed operands and results signed on both sides of arithmetic. Part-selects and concatenations are unsigned; cast them when needed.
Widen operands before multiplication or addition. Compare the wide result against signed limits, then assign the appropriate limit on overflow. Never implement saturation by slicing away overflow bits.

Follow the specified reset, handshake and cycle latency. Keep testbench delays out of synthesizable logic.
Drive testbench inputs away from the active clock edge. For each check, print $display("PASS name") or $display("FAIL name ..."). End with $finish.
Compile after edits, simulate the testbench, and read failures before claiming success.
