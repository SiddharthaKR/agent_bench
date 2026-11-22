`timescale 1ns/1ps

module tb_top;
    reg clk;
    reg reset;
    reg data;
    wire start_shifting;

    TopModule dut (
        .clk(clk),
        .reset(reset),
        .data(data),
        .start_shifting(start_shifting)
    );

    reg [3:0] history;
    integer valid_bits;
    reg expected;
    reg model_known;
    integer checks;
    integer failures;
    integer cycle;
    integer pattern;
    integer bit_index;
    integer i;
    integer seed;
    reg random_data;
    reg random_reset;

    initial clk = 1'b0;
    always #5 clk = ~clk;

    task automatic check_output(input string name);
        begin
            checks = checks + 1;
            if (start_shifting === expected)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%b got=%b inputs=clk:%b,reset:%b,data:%b,history:%b,valid_bits:%0d,cycle:%0d",
                         name, expected, start_shifting, clk, reset, data,
                         history, valid_bits, cycle);
            end
        end
    endtask

    // Drive strictly between active edges. The first check also verifies that
    // reset is synchronous and data changes cannot alter the registered output.
    task automatic step(input reg next_reset, input reg next_data,
                        input string name);
        begin
            @(negedge clk);
            #1;
            reset = next_reset;
            data = next_data;
            #1;
            if (model_known)
                check_output($sformatf("%s_before_edge", name));
            @(posedge clk);
            cycle = cycle + 1;
            if (reset) begin
                history = 4'b0000;
                valid_bits = 0;
                expected = 1'b0;
                model_known = 1'b1;
            end else begin
                history = {history[2:0], data};
                if (valid_bits < 4)
                    valid_bits = valid_bits + 1;
                if ((valid_bits == 4) && (history == 4'b1101))
                    expected = 1'b1;
            end
            #1; // Allow nonblocking assignments in the DUT to settle.
            check_output($sformatf("%s_after_edge", name));
        end
    endtask

    task automatic stream(input reg [31:0] bits, input integer length,
                          input string name);
        integer k;
        begin
            for (k = length - 1; k >= 0; k = k - 1)
                step(1'b0, bits[k], $sformatf("%s_bit_%0d", name, length-1-k));
        end
    endtask

    initial begin
        reset = 1'b0;
        data = 1'b0;
        history = 4'b0000;
        valid_bits = 0;
        expected = 1'b0;
        model_known = 1'b0;
        checks = 0;
        failures = 0;
        cycle = 0;
        seed = 32'h19631101;

        step(1'b1, 1'b0, "initial_synchronous_reset");
        stream(32'b1101, 4, "exact_match");
        stream(32'h00000000, 32, "sticky_after_zeros");
        stream(32'hffffffff, 32, "sticky_after_ones");
        stream(32'h1101abcd, 32, "sticky_after_mixed_data");
        step(1'b1, 1'b1, "clear_sticky_synchronously");
        step(1'b1, 1'b1, "held_reset_one");
        step(1'b1, 1'b0, "held_reset_zero");
        stream(32'b101, 3, "reset_data_not_part_of_match");

        // Reset each possible proper prefix; no partial match may survive.
        for (i = 1; i <= 3; i = i + 1) begin
            step(1'b1, 1'b0, $sformatf("prefix_%0d_setup", i));
            case (i)
                1: stream(32'b1, 1, "prefix_1");
                2: stream(32'b11, 2, "prefix_11");
                3: stream(32'b110, 3, "prefix_110");
            endcase
            step(1'b1, 1'b1, $sformatf("reset_prefix_%0d", i));
            stream(32'b01, 2, "suffix_after_reset");
            stream(32'b1101, 4, "fresh_match_after_reset");
        end

        step(1'b1, 1'b0, "reset_on_completion_setup");
        stream(32'b110, 3, "reset_on_completion_prefix");
        step(1'b1, 1'b1, "reset_wins_over_match");
        stream(32'b101, 3, "no_match_across_reset");

        step(1'b1, 1'b0, "fallback_setup");
        stream(32'b111101, 6, "repeated_ones_fallback");
        step(1'b1, 1'b0, "overlap_setup");
        stream(32'b1101101, 7, "overlapping_matches");
        step(1'b1, 1'b0, "near_misses_setup");
        stream(32'b1010101001100010, 16, "near_misses_and_fallbacks");

        // All eight-bit streams cover every short prefix, mismatch, and
        // possible position of the first complete four-bit match.
        for (pattern = 0; pattern < 256; pattern = pattern + 1) begin
            step(1'b1, 1'b0, $sformatf("exhaustive_%0d_reset", pattern));
            for (bit_index = 7; bit_index >= 0; bit_index = bit_index - 1)
                step(1'b0, (pattern >> bit_index) & 1,
                     $sformatf("exhaustive_%0d_bit_%0d", pattern, 7-bit_index));
        end

        // Frequent resets exercise both partial-prefix clearing and latch
        // clearing; uninterrupted sections exercise persistent assertion.
        for (i = 0; i < 3000; i = i + 1) begin
            random_data = ($random(seed) & 1);
            random_reset = (($random(seed) & 31) == 0);
            step(random_reset, random_data, $sformatf("random_%0d", i));
        end
        step(1'b1, 1'b0, "final_reset");
        stream(32'b1101, 4, "final_match");
        for (i = 0; i < 128; i = i + 1) begin
            random_data = ($random(seed) & 1);
            step(1'b0, random_data, $sformatf("final_sticky_%0d", i));
        end
        step(1'b1, 1'b0, "final_clear");
        if (failures == 0)
            $display("PASS summary checks=%0d failures=0", checks);
        else
            $display("FAIL summary expected=0 got=%0d inputs=checks:%0d,cycles:%0d",
                     failures, checks, cycle);
        $finish;
    end
endmodule
