`timescale 1ns/1ps

module tb_top;
    reg in;
    reg [1:0] state;
    wire [1:0] next_state;
    wire out;

    integer checks = 0;
    integer failures = 0;
    integer source;
    integer destination;
    integer trial;
    reg [2:0] random_inputs;

    TopModule dut (
        .in(in),
        .state(state),
        .next_state(next_state),
        .out(out)
    );

    // The reference values come directly from the specified transition table.
    // There is no clock or reset: state is an externally supplied input.
    task automatic check_case(
        input [1:0] current_state,
        input input_bit,
        input string name
    );
        reg [1:0] expected_next;
        reg expected_out;
        begin
            case (current_state)
                2'b00: begin
                    expected_next = input_bit ? 2'b01 : 2'b00;
                    expected_out = 1'b0;
                end
                2'b01: begin
                    expected_next = input_bit ? 2'b01 : 2'b10;
                    expected_out = 1'b0;
                end
                2'b10: begin
                    expected_next = input_bit ? 2'b11 : 2'b00;
                    expected_out = 1'b0;
                end
                2'b11: begin
                    expected_next = input_bit ? 2'b01 : 2'b10;
                    expected_out = 1'b1;
                end
            endcase

            // Allow separation between input changes and sample after settling.
            #1;
            state = current_state;
            in = input_bit;
            #1;
            checks = checks + 1;
            if ({next_state, out} === {expected_next, expected_out})
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%03b got=%03b inputs=state:%02b,in:%01b",
                         name, {expected_next, expected_out},
                         {next_state, out}, state, in);
            end
        end
    endtask

    initial begin
        state = 2'b00;
        in = 1'b0;

        // Exhaust the complete truth table, including B's in=1 self-loop,
        // A's in=0 self-loop, and both input values in output-high state D.
        for (destination = 0; destination < 8; destination = destination + 1)
            check_case(destination[2:1], destination[0],
                       $sformatf("truth_table_%0d", destination));

        // Every ordered pair of legal input combinations checks history
        // independence, including unchanged inputs and simultaneous changes.
        for (source = 0; source < 8; source = source + 1) begin
            for (destination = 0; destination < 8; destination = destination + 1) begin
                check_case(source[2:1], source[0],
                           $sformatf("pair_%0d_%0d_source", source, destination));
                check_case(destination[2:1], destination[0],
                           $sformatf("pair_%0d_%0d_destination", source, destination));
            end
        end

        for (trial = 0; trial < 256; trial = trial + 1) begin
            random_inputs = $urandom_range(0, 7);
            check_case(random_inputs[2:1], random_inputs[0],
                       $sformatf("random_%0d", trial));
        end

        $display("SUMMARY checks=%0d failures=%0d (values are {next_state,out})",
                 checks, failures);
        $finish;
    end
endmodule
