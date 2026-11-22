`timescale 1ns/1ps

module tb_top;
    reg clk = 1'b0;
    reg reset = 1'b1;
    wire [2:0] ena;
    wire [15:0] q;

    integer expected_count;
    integer checks = 0;
    integer failures = 0;
    integer i;
    integer target;
    integer seed = 32'h1257abcd;
    reg random_reset;

    TopModule dut (
        .clk(clk),
        .reset(reset),
        .ena(ena),
        .q(q)
    );

    always #5 clk = ~clk;

    function automatic [15:0] encode_bcd(input integer value);
        integer n;
        integer digit;
        begin
            n = value;
            encode_bcd = 16'h0000;
            for (digit = 0; digit < 4; digit = digit + 1) begin
                encode_bcd[digit*4 +: 4] = n % 10;
                n = n / 10;
            end
        end
    endfunction

    // Enables describe carry conditions in the current counter value.
    function automatic [2:0] expected_enables(input integer value);
        begin
            expected_enables[0] = (value % 10 == 9);
            expected_enables[1] = (value % 100 == 99);
            expected_enables[2] = (value % 1000 == 999);
        end
    endfunction

    task automatic check_outputs(input string name);
        reg [15:0] want_q;
        reg [2:0] want_ena;
        begin
            want_q = encode_bcd(expected_count);
            want_ena = expected_enables(expected_count);
            checks = checks + 1;
            if ((q === want_q) && (ena === want_ena)) begin
                $display("PASS %s", name);
            end else begin
                failures = failures + 1;
                $display("FAIL %s expected=q:%04h,ena:%03b got=q:%04h,ena:%03b inputs=clk:%b,reset:%b,count:%0d",
                         name, want_q, want_ena, q, ena,
                         clk, reset, expected_count);
            end
        end
    endtask

    task automatic tick(input reg next_reset, input string name);
        begin
            // Reset changes only on falling edges. The check before the
            // next rising edge also rejects an asynchronous reset.
            @(negedge clk);
            reset = next_reset;
            #1;
            check_outputs($sformatf("%s_before_rising_edge", name));
            @(posedge clk);
            if (next_reset)
                expected_count = 0;
            else if (expected_count == 9999)
                expected_count = 0;
            else
                expected_count = expected_count + 1;
            #1;
            check_outputs($sformatf("%s_after_rising_edge", name));
        end
    endtask

    initial begin
        // No assertion is made about power-up state before a reset edge.
        @(posedge clk);
        expected_count = 0;
        #1;
        check_outputs("initial_synchronous_reset");

        repeat (3) tick(1'b1, "held_reset");

        // Exhaust every legal BCD state and every enable combination,
        // including 0009, 0099, 0999, and the 9999 -> 0000 wrap.
        // Since the only non-clock input is reset, this also exhausts
        // the legal input space of the combinational enable logic.
        for (i = 0; i < 10000; i = i + 1)
            tick(1'b0, $sformatf("complete_decimal_cycle_%0d", i + 1));

        // Assert reset with each possible carry depth pending. Checking
        // before and after the edge verifies timing and reset priority.
        target = 9;
        while (target <= 9999) begin
            while (expected_count != target)
                tick(1'b0, $sformatf("approach_reset_at_%0d_count_%0d",
                                    target, expected_count));
            tick(1'b1, $sformatf("reset_at_%0d", target));
            tick(1'b1, $sformatf("reset_at_%0d_held", target));
            tick(1'b0, $sformatf("restart_after_reset_at_%0d", target));
            target = target * 10 + 9;
        end

        // Reproducible random reset pulses, consecutive resets, and
        // deassertions exercise transitions at arbitrary counter values.
        for (i = 0; i < 2000; i = i + 1) begin
            random_reset = (($random(seed) & 32'h0000001f) == 0);
            tick(random_reset, $sformatf("random_reset_%0d", i));
        end

        tick(1'b1, "final_reset");
        tick(1'b0, "final_restart");
        if (failures == 0)
            $display("PASS summary checks=%0d failures=0", checks);
        else
            $display("FAIL summary expected=0 got=%0d inputs=checks:%0d",
                     failures, checks);
        $finish;
    end
endmodule
