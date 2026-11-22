`timescale 1ns/1ps

module tb_top;
    reg clk = 1'b0;
    reg d = 1'b0;
    reg r = 1'b0;
    wire q;
    reg expected;
    reg random_d;
    reg random_r;
    integer seed = 32'h1735a9c1;
    integer i;
    integer checks = 0;
    integer failures = 0;

    TopModule dut (.clk(clk), .d(d), .r(r), .q(q));

    always #5 clk = ~clk;

    task check_q(input string name, input reg want);
        begin
            checks = checks + 1;
            if (q === want)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%b got=%b inputs=clk:%b,d:%b,r:%b time=%0t",
                         name, want, q, clk, d, r, $time);
            end
        end
    endtask

    // Change both inputs on the falling edge. Neither the falling edge nor
    // an asserted synchronous reset may change the stored value here.
    task cycle(input reg next_d, input reg next_r, input string name);
        begin
            @(negedge clk);
            d = next_d;
            r = next_r;
            #1;
            check_q({name, "_hold_after_falling_edge"}, expected);
            #2;
            check_q({name, "_hold_before_rising_edge"}, expected);
            @(posedge clk);
            expected = next_r ? 1'b0 : next_d;
            #1; // Allow the DUT's nonblocking assignment to settle.
            check_q({name, "_capture"}, expected);
        end
    endtask

    initial begin
        // The specification does not define power-up state. Establish a
        // known state with a rising edge while reset is asserted.
        #1;
        d = 1'b1;
        r = 1'b1;
        @(posedge clk);
        expected = 1'b0;
        #1;
        check_q("initial_synchronous_reset_overrides_one", expected);

        cycle(1'b0, 1'b1, "reset_held_data_zero");
        cycle(1'b1, 1'b1, "reset_held_data_one");
        cycle(1'b1, 1'b0, "release_reset_capture_one");
        cycle(1'b0, 1'b1, "assert_reset_from_one");
        cycle(1'b1, 1'b1, "consecutive_reset");
        cycle(1'b0, 1'b0, "release_reset_capture_zero");
        cycle(1'b1, 1'b0, "capture_one");
        cycle(1'b1, 1'b0, "retain_one");
        cycle(1'b0, 1'b0, "capture_zero");
        cycle(1'b0, 1'b0, "retain_zero");
        cycle(1'b1, 1'b0, "prepare_between_edges_pulse");

        // A reset/data pulse entirely between rising edges must be ignored.
        @(negedge clk);
        r = 1'b1;
        d = 1'b0;
        #1;
        check_q("between_edges_reset_pulse_asserted", expected);
        #1;
        r = 1'b0;
        d = 1'b1;
        #1;
        check_q("between_edges_reset_pulse_released", expected);
        @(posedge clk);
        expected = 1'b1;
        #1;
        check_q("between_edges_pulse_not_sampled", expected);

        for (i = 0; i < 16; i = i + 1)
            cycle(i % 2, 1'b0, $sformatf("alternating_%0d", i));

        for (i = 0; i < 200; i = i + 1) begin
            random_d = $random(seed);
            random_r = (($random(seed) & 7) == 0);
            cycle(random_d, random_r, $sformatf("random_%0d", i));
        end

        cycle(1'b1, 1'b1, "final_reset");
        if (failures == 0)
            $display("PASS summary checks=%0d failures=0", checks);
        else
            $display("FAIL summary expected=0 got=%0d inputs=clk:%b,d:%b,r:%b checks=%0d",
                     failures, clk, d, r, checks);
        $finish;
    end
endmodule
