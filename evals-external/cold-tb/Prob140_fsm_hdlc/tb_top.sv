`timescale 1ns/1ps

module tb_top;
    reg clk = 1'b0;
    reg reset = 1'b0;
    reg in = 1'b0;
    wire disc, flag, err;

    TopModule dut (
        .clk(clk),
        .reset(reset),
        .in(in),
        .disc(disc),
        .flag(flag),
        .err(err)
    );

    always #5 clk = ~clk;

    // The reference tracks only the run length described by the spec.
    // Seven represents every run of seven or more consecutive ones.
    integer ones = 0;
    reg [2:0] expected = 3'b000;
    reg model_valid = 1'b0;
    integer checks = 0;
    integer failures = 0;
    integer samples = 0;
    integer pattern, bit_index, run_length, i;
    reg random_reset, random_bit;
    reg [31:0] rng = 32'h6a09e667;

    // Local deterministic PRNG, independent of simulator random seeds.
    function automatic [31:0] next_random(input [31:0] x);
        reg [31:0] y;
        begin
            y = x ^ (x << 13);
            y = y ^ (y >> 17);
            next_random = y ^ (y << 5);
        end
    endfunction

    task automatic check_outputs(input string name, input [2:0] want);
        begin
            checks = checks + 1;
            if ({disc, flag, err} === want)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%03b got=%03b inputs=clk:%b,reset:%b,in:%b,run:%0d,sample:%0d",
                         name, want, {disc, flag, err}, clk, reset, in,
                         ones, samples);
            end
        end
    endtask

    task automatic step(input reg rst, input reg data_bit, input string name);
        reg [2:0] next_expected;
        begin
            // Change both inputs on the inactive edge. A Moore output,
            // including synchronous reset, must wait for a rising edge.
            @(negedge clk);
            reset = rst;
            in = data_bit;
            #1;
            if (model_valid)
                check_outputs($sformatf("%s_between_edges", name), expected);

            @(posedge clk);
            next_expected = 3'b000;
            if (rst) begin
                ones = 0;
            end else if (data_bit) begin
                if (ones < 7)
                    ones = ones + 1;
                if (ones >= 7)
                    next_expected[0] = 1'b1;
            end else begin
                if (ones == 5)
                    next_expected[2] = 1'b1;
                if (ones == 6)
                    next_expected[1] = 1'b1;
                ones = 0;
            end
            expected = next_expected;
            model_valid = 1'b1;
            samples = samples + 1;
            #1; // Sample after nonblocking sequential updates settle.
            check_outputs($sformatf("%s_after_edge", name), expected);
            // Also check near the end of the cycle's high phase.
            #3;
            check_outputs($sformatf("%s_hold", name), expected);
        end
    endtask

    initial begin
        // No assumptions about power-up state before the first reset edge.
        step(1'b1, 1'b1, "initial_reset_with_one");
        step(1'b1, 1'b0, "held_reset_with_zero");
        step(1'b0, 1'b0, "release_reset_zero");

        // Exact threshold lengths, extended error runs, and recovery.
        for (run_length = 0; run_length <= 12; run_length = run_length + 1) begin
            step(1'b0, 1'b0, $sformatf("run_%0d_leading_zero", run_length));
            for (i = 0; i < run_length; i = i + 1)
                step(1'b0, 1'b1, $sformatf("run_%0d_one_%0d", run_length, i));
            step(1'b0, 1'b0, $sformatf("run_%0d_terminator", run_length));
            step(1'b0, 1'b0, $sformatf("run_%0d_pulse_cleared", run_length));
        end

        // A terminating zero also starts the next pattern: exercise shared
        // boundaries, repeated discard pulses, flags, and error recovery.
        for (pattern = 0; pattern < 24; pattern = pattern + 1) begin
            run_length = 5 + (pattern % 3);
            for (i = 0; i < run_length; i = i + 1)
                step(1'b0, 1'b1, $sformatf("shared_boundary_%0d_one_%0d", pattern, i));
            step(1'b0, 1'b0, $sformatf("shared_boundary_%0d_zero", pattern));
        end

        // Reset in every run state, including while each pulse is active.
        for (run_length = 0; run_length <= 9; run_length = run_length + 1) begin
            step(1'b1, 1'b0, $sformatf("reset_case_%0d_start", run_length));
            for (i = 0; i < run_length; i = i + 1)
                step(1'b0, 1'b1, $sformatf("reset_case_%0d_one_%0d", run_length, i));
            if ((run_length == 5) || (run_length == 6))
                step(1'b0, 1'b0, $sformatf("reset_case_%0d_activate_pulse", run_length));
            step(1'b1, 1'b1, $sformatf("reset_case_%0d_assert", run_length));
            step(1'b1, 1'b1, $sformatf("reset_case_%0d_hold", run_length));
            // Reset behaves as a preceding zero, even with input held high.
            for (i = 0; i < 7; i = i + 1)
                step(1'b0, 1'b1, $sformatf("reset_case_%0d_restart_%0d", run_length, i));
            step(1'b0, 1'b0, $sformatf("reset_case_%0d_recover", run_length));
        end

        // Exhaust all ten-bit streams from the specified reset history.
        for (pattern = 0; pattern < 1024; pattern = pattern + 1) begin
            step(1'b1, 1'b0, $sformatf("exhaustive_%0d_reset", pattern));
            for (bit_index = 9; bit_index >= 0; bit_index = bit_index - 1)
                step(1'b0, (pattern >> bit_index) & 1,
                     $sformatf("exhaustive_%0d_bit_%0d", pattern, bit_index));
            step(1'b0, 1'b0, $sformatf("exhaustive_%0d_flush", pattern));
        end

        // Sustained errors must remain asserted until a zero or reset.
        for (i = 0; i < 128; i = i + 1)
            step(1'b0, 1'b1, $sformatf("long_error_run_%0d", i));
        step(1'b0, 1'b0, "long_error_recovery");

        // Balanced and one-heavy streams cover short data runs and frequent
        // threshold crossings, with occasional synchronous resets.
        for (i = 0; i < 4000; i = i + 1) begin
            rng = next_random(rng);
            random_reset = (rng[15:8] == 8'h00);
            if (i < 2000)
                random_bit = rng[0];
            else
                random_bit = (rng[2:0] != 3'b000);
            step(random_reset, random_bit, $sformatf("random_%0d", i));
        end
        step(1'b1, 1'b0, "final_reset");
        step(1'b0, 1'b0, "final_idle");
        if (failures == 0)
            $display("PASS summary checks=%0d samples=%0d", checks, samples);
        else
            $display("FAIL summary expected=0 got=%0d inputs=checks:%0d,samples:%0d",
                     failures, checks, samples);
        $finish;
    end
endmodule
