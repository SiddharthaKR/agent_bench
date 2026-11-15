---
name: pipelining
description: Load when RTL has clocked data paths, multiple stages or valid signals whose latency must match.
always: false
---
Decide the latency from the spec first; add a register stage only when the spec allows that latency.

Count the clock edges from sampling an input to its corresponding output. An output reg assigned in a clocked block is already a stage. Intermediate wires do not add latency. Nonblocking assignments in the same block read the previous register values.

Name stages by delay, such as product_d1 and sum_d2. Delay valid and side-band fields (tag, address, last) through the same stages as their data. If the interface stalls, advance or hold data and valid together according to the specified enable or handshake. Invalid data must never be consumed as a result.

For a two-stage path permitted by the spec:
```verilog
module pipeline(input clk, rst, valid_in,
	input signed [7:0] a, b,
	output reg signed [15:0] y,
	output reg valid_out);
	reg signed [15:0] product_d1;
	reg valid_d1;
	always @(posedge clk) begin
		if (rst) begin
			valid_d1 <= 1'b0;
			valid_out <= 1'b0;
		end else begin
			product_d1 <= a * b;
			y <= product_d1;
			valid_d1 <= valid_in;
			valid_out <= valid_d1;
		end
	end
endmodule
```

When timing requires splitting multiply, add and saturation, first check that the allowed latency has enough stages. If latency is fixed at one clock, compute intermediates combinationally and register only the final output. Do not silently increase latency to improve timing.

When DSP inference matters and the spec permits it, register multiplier inputs and output. Prefer no reset on data registers hidden by reset valid bits, or a supported synchronous reset. Check the target device's inference requirements.

Verify latency with isolated valid pulses, bubbles, back-to-back samples and reset during traffic. Align the testbench reference queue to the specified latency before changing the RTL.
