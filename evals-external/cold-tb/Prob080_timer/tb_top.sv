`timescale 1ns/1ps

module tb_top;
    reg clk;
    reg load;
    reg [9:0] data;
    wire tc;

    TopModule dut (
        .clk(clk),
        .load(load),
        .data(data),
        .tc(tc)
    );

    integer expected_count;
    integer checks;
    integer failures;
    integer i;
    integer j;
    integer duration;
    reg initialized;
    reg expected_tc;
    reg [31:0] rng;
    reg random_load;
    reg [9:0] random_data;

    initial begin
        clk = 1'b0;
        forever #5 clk = ~clk;
    end

    // Fixed-seed local PRNG keeps the stimulus reproducible.
    task next_random;
        begin
            rng = rng ^ (rng << 13);
            rng = rng ^ (rng >> 17);
            rng = rng ^ (rng << 5);
        end
    endtask

    task check_tc(input string name);
        begin
            expected_tc = (expected_count == 0);
            checks = checks + 1;
            if (tc === expected_tc)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%b got=%b inputs=clk:%b,load:%b,data:%0d,model_count:%0d",
                         name, expected_tc, tc, clk, load, data, expected_count);
            end
        end
    endtask

    // Inputs change on the falling edge. Check both that inputs cannot
    // change the current terminal indication and that the next rising
    // edge performs the specified load or saturating decrement.
    task cycle(input reg next_load, input reg [9:0] next_data,
               input string name);
        begin
            @(negedge clk);
            load = next_load;
            data = next_data;
            #1;
            if (initialized)
                check_tc($sformatf("%s_before_rising_edge", name));
            @(posedge clk);
            if (next_load) begin
                expected_count = next_data;
                initialized = 1'b1;
            end else if (initialized && expected_count > 0)
                expected_count = expected_count - 1;
            #1;
            if (initialized)
                check_tc($sformatf("%s_after_rising_edge", name));
        end
    endtask

    initial begin
        load = 1'b0;
        data = 10'd0;
        expected_count = 0;
        initialized = 1'b0;
        checks = 0;
        failures = 0;
        rng = 32'h73a9c521;

        // There is no reset port or specified power-up state. Establish
        // a known state using load before making any output assertions.
        cycle(1'b1, 10'd0, "initialize_load_zero");
        for (i = 0; i < 8; i = i + 1)
            cycle(1'b0, 10'd1023, $sformatf("zero_stays_zero_%0d", i));

        cycle(1'b1, 10'd1, "load_one");
        cycle(1'b0, 10'd777, "one_times_out");
        cycle(1'b0, 10'd0, "one_stays_timed_out");

        // Include small durations, the high-bit boundary, and full scale.
        for (i = 0; i < 6; i = i + 1) begin
            case (i)
                0: duration = 2;
                1: duration = 3;
                2: duration = 511;
                3: duration = 512;
                4: duration = 1022;
                5: duration = 1023;
            endcase
            cycle(1'b1, duration, $sformatf("load_duration_%0d", duration));
            for (j = 0; j < duration + 3; j = j + 1) begin
                next_random;
                cycle(1'b0, rng[9:0],
                      $sformatf("duration_%0d_tick_%0d", duration, j));
            end
        end

        // Reload while busy, including both shortening and extending.
        cycle(1'b1, 10'd1023, "busy_start");
        cycle(1'b0, 10'd0, "busy_decrement");
        cycle(1'b1, 10'd2, "busy_reload_shorter");
        cycle(1'b0, 10'd1023, "shorter_decrement");
        cycle(1'b1, 10'd512, "reload_on_would_be_timeout");
        cycle(1'b0, 10'd1, "extended_decrement");
        cycle(1'b1, 10'd0, "busy_reload_zero");
        cycle(1'b0, 10'd512, "reload_zero_holds");

        // Continuous load must win over decrement on every rising edge.
        for (i = 0; i < 1024; i = i + 1)
            cycle(1'b1, i, $sformatf("consecutive_load_%0d", i));
        for (i = 0; i < 5; i = i + 1)
            cycle(1'b1, 10'd1, $sformatf("hold_load_one_%0d", i));
        cycle(1'b0, 10'd0, "release_held_load");

        // Random short durations repeatedly exercise actual expiration;
        // full-width loads also exercise long-running and interrupted timers.
        for (i = 0; i < 3000; i = i + 1) begin
            next_random;
            random_load = (rng[3:0] == 0) || (rng[3:0] == 1);
            next_random;
            if (rng[31])
                random_data = {6'd0, rng[3:0]};
            else
                random_data = rng[9:0];
            cycle(random_load, random_data, $sformatf("random_%0d", i));
        end

        // Drain any final random load, then check saturation for many clocks.
        for (i = 0; i < 1030; i = i + 1) begin
            next_random;
            cycle(1'b0, rng[9:0], $sformatf("final_drain_%0d", i));
        end

        if (failures == 0)
            $display("PASS summary checks=%0d failures=0", checks);
        else
            $display("FAIL summary expected=0 got=%0d inputs=completed_checks:%0d",
                     failures, checks);
        $finish;
    end

    initial begin
        #200000;
        $display("FAIL watchdog expected=completion got=timeout inputs=clk:%b,load:%b,data:%0d",
                 clk, load, data);
        $finish;
    end
endmodule
