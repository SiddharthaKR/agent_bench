---
name: reset-and-state
description: Load when implementing reset behavior, an FSM, control registers or debugging multiple drivers.
always: false
---
Use the reset polarity, timing and values from the spec and match surrounding code. Synchronous reset is sampled only at the active clock edge. An asynchronous reset also acts on its assertion edge.

```verilog
module reset_forms(input clk, rst, rst_n, d,
	output reg sync_q, async_q);
	always @(posedge clk) begin
		if (rst) sync_q <= 1'b0;
		else sync_q <= d;
	end
	always @(posedge clk or negedge rst_n) begin
		if (!rst_n) async_q <= 1'b0;
		else async_q <= d;
	end
endmodule
```

Reset control and state registers: FSM state, valid bits, counters and configuration registers, each to its exact specified value. If invalid data cannot be observed and valid is reset, pure data pipeline registers may omit reset. If outputs have specified reset values, reset them even when valid is low. When an asynchronous reset comes from outside the clock domain, follow the design's reset-release synchronization policy.

Use case with default for an FSM. Give combinational outputs defaults to avoid latches. Use blocking assignments for next-state logic and nonblocking assignments for registers. One driver per signal: never assign the same reg from two always blocks or from both always and assign.

```verilog
module state_machine(input clk, rst, start, done,
	output reg busy);
	localparam IDLE = 1'b0, RUN = 1'b1;
	reg state, next_state;
	always @* begin
		next_state = state;
		busy = 1'b0;
		case (state)
			IDLE: if (start) next_state = RUN;
			RUN: begin
				busy = 1'b1;
				if (done) next_state = IDLE;
			end
			default: next_state = IDLE;
		endcase
	end
	always @(posedge clk) begin
		if (rst) state <= IDLE;
		else state <= next_state;
	end
endmodule
```

Test reset at startup and during active work. For synchronous reset, verify it acts at the clock edge; for asynchronous reset, also verify assertion between edges. Check the first transaction after reset.
