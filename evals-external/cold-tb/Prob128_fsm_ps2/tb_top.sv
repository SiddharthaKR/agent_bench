`timescale 1ns/1ps

module tb_top;
    reg clk = 1'b0;
    reg reset = 1'b0;
    reg [7:0] in = 8'h00;
    wire done;

    TopModule dut (.clk(clk), .reset(reset), .in(in), .done(done));

    always #5 clk = ~clk;

    // Number of bytes already accepted in the current message.
    integer accepted = 0;
    reg expected_done = 1'b0;
    reg initialized = 1'b0;
    integer checks = 0;
    integer failures = 0;
    integer i;
    integer pattern;
    reg [31:0] rng = 32'h53a91c27;
    reg [7:0] random_byte;
    reg random_reset;

    task check_done;
        input string name;
        input reg expected;
        begin
            checks = checks + 1;
            if (done === expected)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%b got=%b inputs=reset:%b,in:%02h,accepted:%0d",
                         name, expected, done, reset, in, accepted);
            end
        end
    endtask

    task step;
        input string name;
        input reg rst;
        input reg [7:0] data;
        begin
            // Change all stimulus on the inactive edge. A synchronous
            // reset and input changes must not affect done before posedge.
            @(negedge clk);
            reset = rst;
            in = data;
            #1;
            if (initialized)
                check_done({name, "_before_posedge"}, expected_done);
            @(posedge clk);
            if (rst) begin
                accepted = 0;
                expected_done = 1'b0;
            end else begin
                expected_done = 1'b0;
                case (accepted)
                    0: if (data[3]) accepted = 1;
                    1: accepted = 2;
                    2: begin
                        accepted = 0;
                        expected_done = 1'b1;
                    end
                endcase
            end
            #1;
            initialized = 1'b1;
            check_done(name, expected_done);
        end
    endtask

    // Explicit PRNG keeps stimulus deterministic across simulator runs.
    task advance_rng;
        begin
            rng = rng ^ (rng << 13);
            rng = rng ^ (rng >> 17);
            rng = rng ^ (rng << 5);
        end
    endtask

    initial begin
        step("initial_reset", 1'b1, 8'hff);
        step("held_reset", 1'b1, 8'h08);

        // Exhaust all possible discarded bytes (bit 3 clear).
        for (i = 0; i < 256; i = i + 1)
            if ((i & 8) == 0)
                step($sformatf("discard_%02h", i), 1'b0, i[7:0]);

        // Every possible byte must work in each message position. Only
        // byte 1's bit 3 matters; byte 2 and byte 3 are never reinterpreted.
        for (i = 0; i < 256; i = i + 1) begin
            step($sformatf("message_%0d_first", i), 1'b0, i[7:0] | 8'h08);
            step($sformatf("message_%0d_second", i), 1'b0, i[7:0]);
            step($sformatf("message_%0d_third", i), 1'b0, ~i[7:0]);
        end
        step("done_clears_on_discard", 1'b0, 8'h00);

        // Cover all combinations of marker bits in bytes 2 and 3.
        for (pattern = 0; pattern < 4; pattern = pattern + 1) begin
            step($sformatf("markers_%0d_first", pattern), 1'b0, 8'h08);
            step($sformatf("markers_%0d_second", pattern), 1'b0,
                 (pattern & 1) ? 8'hff : 8'hf7);
            step($sformatf("markers_%0d_third", pattern), 1'b0,
                 (pattern & 2) ? 8'h08 : 8'h00);
        end

        // Reset while done is high also checks that assertion is synchronous.
        step("reset_during_done", 1'b1, 8'hff);
        step("after_done_reset_discard", 1'b0, 8'h00);
        step("reset_after_first_setup", 1'b0, 8'h08);
        step("reset_after_first", 1'b1, 8'h08);
        step("after_first_reset_discard", 1'b0, 8'h00);
        step("reset_after_second_setup_first", 1'b0, 8'h08);
        step("reset_after_second_setup_second", 1'b0, 8'hff);
        step("reset_instead_of_third", 1'b1, 8'hff);
        step("reset_held_again", 1'b1, 8'h00);
        step("after_second_reset_discard", 1'b0, 8'h00);

        // A continuous marker stream yields one done pulse per three bytes.
        for (i = 0; i < 24; i = i + 1)
            step($sformatf("continuous_markers_%0d", i), 1'b0, 8'hff);

        for (i = 0; i < 1500; i = i + 1) begin
            advance_rng;
            random_byte = rng[7:0];
            random_reset = (rng[15:8] < 8'd12);
            step($sformatf("random_%0d", i), random_reset, random_byte);
        end

        step("final_reset", 1'b1, 8'h00);
        step("final_first", 1'b0, 8'h08);
        step("final_second", 1'b0, 8'h00);
        step("final_third", 1'b0, 8'h00);
        step("final_pulse_clear", 1'b0, 8'h00);
        $display("SUMMARY checks=%0d failures=%0d", checks, failures);
        $finish;
    end
endmodule
