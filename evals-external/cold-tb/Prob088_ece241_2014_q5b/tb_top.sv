`timescale 1ns/1ps

module tb_top;
    reg clk;
    reg areset;
    reg x;
    wire z;

    TopModule dut (
        .clk(clk),
        .areset(areset),
        .x(x),
        .z(z)
    );

    // The abstract specification has two states. No DUT internals are used.
    reg in_b;
    integer checks;
    integer failures;
    integer i;
    integer seed;

    initial begin
        clk = 1'b0;
        forever #5 clk = ~clk;
    end

    always @(posedge clk or posedge areset) begin
        if (areset)
            in_b <= 1'b0;
        else if (x)
            in_b <= 1'b1;
    end

    task automatic check_output(input string name);
        reg expected;
        begin
            // A passes x; B complements x, including before a clock edge.
            expected = in_b ? ~x : x;
            checks = checks + 1;
            if (z === expected)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%b got=%b inputs=clk:%b,areset:%b,x:%b,reference_state_B:%b",
                         name, expected, z, clk, areset, x, in_b);
            end
        end
    endtask

    task automatic cycle(input reg value, input string name);
        begin
            // Change data well away from the positive sampling edge.
            @(negedge clk);
            #1 x = value;
            #1 check_output($sformatf("%s_before_edge", name));
            @(posedge clk);
            #1 check_output($sformatf("%s_after_edge", name));
        end
    endtask

    task automatic reset_test(input reg value, input string name);
        begin
            @(negedge clk);
            #1 begin
                x = value;
                areset = 1'b1;
            end
            // These checks precede any positive edge: reset must be async,
            // and z must still implement the Mealy output of reset state A.
            #1 check_output($sformatf("%s_async_assert", name));
            #1 x = ~value;
            #1 check_output($sformatf("%s_reset_data_change", name));
            @(posedge clk);
            #1 check_output($sformatf("%s_reset_clock", name));
            @(negedge clk);
            #1 areset = 1'b0;
            #1 check_output($sformatf("%s_async_release", name));
            @(posedge clk);
            #1 check_output($sformatf("%s_first_released_edge", name));
        end
    endtask

    initial begin
        checks = 0;
        failures = 0;
        seed = 32'h1b74a29d;
        in_b = 1'b0;
        areset = 1'b0;
        x = 1'b0;

        // Establish reset by an actual rising reset edge between clock edges.
        #2 areset = 1'b1;
        #1 check_output("initial_async_reset");
        @(posedge clk);
        #1 check_output("initial_reset_held");
        @(negedge clk);
        #1 areset = 1'b0;
        #1 check_output("initial_reset_release");

        for (i = 0; i < 12; i = i + 1)
            cycle(1'b0, $sformatf("A_zero_hold_%0d", i));
        cycle(1'b1, "A_first_one_enters_B");
        cycle(1'b0, "B_zero_stays_B");
        cycle(1'b1, "B_one_stays_B");
        for (i = 0; i < 16; i = i + 1)
            cycle(i[0], $sformatf("B_alternating_%0d", i));
        for (i = 0; i < 8; i = i + 1)
            cycle(1'b1, $sformatf("B_repeated_one_%0d", i));

        // Reset from B with both input polarities and exercise the first
        // released edge with x=1 and x=0, respectively.
        reset_test(1'b0, "reset_B_start_zero");
        cycle(1'b0, "B_after_reset_one");
        reset_test(1'b1, "reset_B_start_one");
        for (i = 0; i < 8; i = i + 1)
            cycle(1'b0, $sformatf("A_after_reset_zero_%0d", i));
        reset_test(1'b1, "reset_while_A");

        // Periodic resets exercise fresh A-to-B transitions throughout
        // deterministic pseudo-random traffic, as well as absorbing state B.
        for (i = 0; i < 512; i = i + 1) begin
            if ((i % 23) == 0)
                reset_test(($random(seed) & 1), $sformatf("random_reset_%0d", i));
            cycle(($random(seed) & 1), $sformatf("random_data_%0d", i));
        end

        if (failures == 0)
            $display("PASS all_checks count=%0d", checks);
        else
            $display("FAIL all_checks expected=0 got=%0d inputs=checks:%0d", failures, checks);
        $finish;
    end
endmodule
