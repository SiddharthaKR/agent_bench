---
name: bus-registers
description: Load when the module has a bus, an address map, writable registers or register read-back.
always: false
---
Implement the handshake exactly as the spec states it: when ack rises, the read latency, the strobe width. Do not add a ready signal or a wait state the spec does not have.

Go through the register table row by row and implement every row:
- Decode the full address width with named constants. Comparing only low bits aliases other addresses.
- Read-back format per row: a signed N-bit value on a wider bus copies its sign bit into all upper bits; an unsigned one gets zeros. A slice or a concatenation is unsigned, so build the sign extension explicitly.
- Read-only constants return their value. Unknown addresses return what the spec says, usually 0, never the address or stale data.
- Reset values exactly as given. Writes to read-only or unknown addresses change nothing.

Worked module: write, registered read one clock later, ack. Names, widths and addresses are an example; keep the structure.

```verilog
module regs (
	input                    clk,
	input                    rst,
	input             [15:0] addr,
	input                    wen,
	input                    ren,
	input             [31:0] wdata,
	output reg               ack,
	output reg        [31:0] rdata,
	output reg signed [11:0] gain,
	output reg         [3:0] mode
);
	localparam [15:0] GAIN_ADDR = 16'h0010, MODE_ADDR = 16'h0014, ID_ADDR = 16'h0020;
	always @(posedge clk) begin
		if (rst) begin
			gain <= 12'sd0; mode <= 4'd0; ack <= 1'b0; rdata <= 32'd0;
		end else begin
			ack <= wen | ren;
			if (wen) begin
				case (addr)
					GAIN_ADDR: gain <= wdata[11:0];
					MODE_ADDR: mode <= wdata[3:0];
					default: ;                             // ignored
				endcase
			end
			case (addr)
				GAIN_ADDR: rdata <= {{20{gain[11]}}, gain};   // signed: copy the sign bit
				MODE_ADDR: rdata <= {28'd0, mode};            // unsigned: zeros
				ID_ADDR:   rdata <= 32'd7;                    // read-only constant
				default:   rdata <= 32'd0;                    // unknown address
			endcase
		end
	end
endmodule
```

Before you finish, check the file against the register table once more: every address, every read-back format, the constant, the unknown-address value, every reset value.

In a testbench: check each reset value, write a negative value to each signed register and compare the whole read bus, read the constant, read an unknown address.
