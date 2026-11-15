---
name: testbench-template
description: Load when filling in the checks of a testbench made by tb_skeleton.
always: false
---
The skeleton already has the clock, the reset, the instance and the helpers. With tb_checks you give only the statements that go inside its initial block. Keep it to 6 to 12 checks.

Helpers:
- tick; waits one clock. Inputs change on the falling edge; the design samples on the rising edge.
- check("name", got, wanted); compares signed values and prints PASS or FAIL.
- check_hex("name", got, wanted); compares a bus value such as read data.

A registered output appears a fixed number of clocks after the input. Wait that many ticks, plus one, before the check:

```verilog
din = 100; tick; tick;
check("positive", dout, 100);
din = -100; tick; tick;
check("negative", dout, -100);
```

A register bus: drive one operation per group of lines, following the handshake in the spec. For a bus with addr, wen, ren, wdata and registered rdata:

```verilog
addr = 16'h0010; wdata = 32'hFFFFF800; wen = 1; tick; wen = 0;
addr = 16'h0010; ren = 1; tick; ren = 0; tick;
check_hex("gain_readback", rdata, 32'hFFFFF800);
addr = 16'h0FFC; ren = 1; tick; ren = 0; tick;
check_hex("unknown_address", rdata, 32'h0);
```

Rules:
- Only statements: no module, task, initial or always lines, and no declarations. If you need a loop counter, use repeat (n) begin ... end.
- Write decimal values with the sign first (-8192). A sized constant cannot contain a minus sign.
- Check names are short words without spaces.
- Cover: the reset value, zero, a positive and a negative case, saturation in both directions when the spec saturates, the smallest and the largest setting, read-back of every register with a negative value for signed ones, the constant registers, an unknown address.
