`timescale 1ns/1ps

module tb_top;
    reg d;
    reg ena;
    wire q;
    reg expected_q;
    integer i;

    TopModule dut (
        .d(d),
        .ena(ena),
        .q(q)
    );

    // A level-sensitive D latch follows d while enabled and otherwise
    // retains its most recently captured value. There is no clock or reset.
    task automatic check_step(
        input reg next_d,
        input reg next_ena,
        input string name
    );
        begin
            #5;
            d = next_d;
            ena = next_ena;
            if (next_ena)
                expected_q = next_d;
            #1;
            if (q === expected_q)
                $display("PASS %s", name);
            else
                $display("FAIL %s expected=%b got=%b inputs=d:%b,ena:%b",
                         name, expected_q, q, d, ena);
        end
    endtask

    initial begin
        d = 1'bx;
        ena = 1'bx;
        expected_q = 1'bx;

        // Startup storage is unspecified: first establish a known value
        // through the latch's specified enable behavior.
        check_step(0, 1, "initialize_zero");
        check_step(1, 1, "transparent_rising_data");
        check_step(0, 1, "transparent_falling_data");
        check_step(1, 1, "transparent_second_rise");

        check_step(1, 0, "close_holding_one");
        check_step(0, 0, "disabled_ignore_zero");
        check_step(1, 0, "disabled_ignore_one");
        check_step(0, 0, "disabled_hold_one_again");
        check_step(0, 1, "enable_captures_stable_zero");
        check_step(0, 0, "close_holding_zero");
        check_step(1, 0, "disabled_hold_zero");
        check_step(0, 0, "disabled_hold_zero_again");
        check_step(1, 0, "prepare_stable_one");
        check_step(1, 1, "enable_captures_stable_one");

        // Sustained enable exercises transparency without enable edges.
        for (i = 0; i < 64; i = i + 1)
            check_step($urandom_range(0, 1), 1,
                       $sformatf("random_transparent_%0d", i));

        check_step(0, 1, "prepare_zero_retention");
        for (i = 0; i < 64; i = i + 1)
            check_step($urandom_range(0, 1), 0,
                       $sformatf("random_hold_zero_%0d", i));

        check_step(1, 1, "prepare_one_retention");
        for (i = 0; i < 64; i = i + 1)
            check_step($urandom_range(0, 1), 0,
                       $sformatf("random_hold_one_%0d", i));

        // Arbitrary binary input pairs cover repeated levels and enable
        // transitions, including simultaneous data and enable changes.
        for (i = 0; i < 512; i = i + 1)
            check_step($urandom_range(0, 1), $urandom_range(0, 1),
                       $sformatf("random_pair_%0d", i));

        $finish;
    end
endmodule
