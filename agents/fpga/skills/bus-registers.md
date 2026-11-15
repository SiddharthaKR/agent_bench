---
name: bus-registers
description: Load when implementing a bus handshake, address map, writable registers or register read-back.
always: false
---
Implement the handshake exactly as specified: request acceptance, strobe width, acknowledge timing, read latency and behavior under back-to-back requests. Do not add a ready signal, wait state or output register unless the contract allows it. If byte enables exist, update only the selected bytes. If a request can remain asserted, follow the specified acceptance rule so one transfer is not accidentally repeated.

Decode the full address width defined by the spec. Comparing only low bits can alias unrelated addresses. Use named address constants of the correct width. For unknown or unaligned addresses, return the specified data and response; do not assume every bus returns zero. Respect read-only, write-only and write-one-to-clear semantics when specified.

For signed N-bit values exposed on a wider W-bit bus, sign-extend before read-back. If the bus register is defined as unsigned, zero-extend instead. A slice or concatenation is unsigned in expressions; cast only when subsequent signed arithmetic requires it.

If the spec requires combinational reads and zero for unmapped addresses, use this pattern:
```verilog
module register_read(input [15:0] address,
	input signed [11:0] gain,
	output reg [31:0] read_data);
	localparam [15:0] GAIN_ADDR = 16'h0010;
	always @* begin
		read_data = 32'd0;
		case (address)
			GAIN_ADDR: read_data = {{20{gain[11]}}, gain};
			default: read_data = 32'd0;
		endcase
	end
endmodule
```

Test each register's reset value, then write and read it back using the actual handshake and read latency. For signed registers include a negative value and check the entire read bus. Test an address differing only in upper bits, unknown addresses, and back-to-back writes and reads. If byte enables or special access semantics exist, test them too.
