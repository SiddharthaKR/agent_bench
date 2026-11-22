`timescale 1ns/1ps

module tb_top;
    reg clk = 1'b0;
    reg resetn = 1'b1;
    reg in = 1'b0;
    wire out;

    TopModule dut (
        .clk(clk),
        .resetn(resetn),
        .in(in),
        .out(out)
    );

    always #5 clk = ~clk;

    reg [3:0] expected_pipe = 4'b0000;
    reg model_valid = 1'b0;
    integer checks = 0;
    integer failures = 0;
    integer i;
    reg random_resetn;
    reg random_in;

    task automatic check_output(input string name, input reg expected);
        begin
            checks = checks + 1;
            if (out === expected)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%b got=%b inputs=clk:%b,resetn:%b,in:%b,time:%0t",
                         name, expected, out, clk, resetn, in, $time);
            end
        end
    endtask

    // Each bit advances one stage at a rising edge; reset clears all four.
    // Inputs change only at falling edges, and outputs settle before sampling.
    task automatic cycle(input reg rst_n, input reg data, input string name);
        begin
            @(negedge clk);
            resetn = rst_n;
            in = data;
            #1;
            if (model_valid)
                check_output({name, "_before_rising_edge"}, expected_pipe[3]);
            @(posedge clk);
            if (!rst_n)
                expected_pipe = 4'b0000;
            else
                expected_pipe = {expected_pipe[2:0], data};
            model_valid = 1'b1;
            #1;
            check_output({name, "_after_rising_edge"}, expected_pipe[3]);
        end
    endtask

    initial begin
        // Do not assume any power-on state before the first reset edge.
        cycle(1'b0, 1'b1, "initial_reset");
        cycle(1'b0, 1'b0, "held_reset_zero_input");
        cycle(1'b0, 1'b1, "held_reset_one_input");

        // An isolated one must emerge on exactly the fourth capture edge.
        cycle(1'b1, 1'b1, "impulse_capture");
        for (i = 0; i < 7; i = i + 1)
            cycle(1'b1, 1'b0, $sformatf("impulse_follow_%0d", i));

        for (i = 0; i < 8; i = i + 1)
            cycle(1'b1, 1'b1, $sformatf("fill_ones_%0d", i));

        // A reset pulse entirely between rising edges must have no effect.
        @(negedge clk);
        resetn = 1'b0;
        in = 1'b1;
        #1;
        check_output("synchronous_reset_pulse_asserted", expected_pipe[3]);
        #2;
        resetn = 1'b1;
        #1;
        check_output("synchronous_reset_pulse_released", expected_pipe[3]);
        @(posedge clk);
        expected_pipe = {expected_pipe[2:0], in};
        #1;
        check_output("synchronous_reset_pulse_not_captured", expected_pipe[3]);

        // Check reset assertion while the output is one, plus reset priority.
        cycle(1'b0, 1'b1, "reset_full_pipeline");
        for (i = 0; i < 6; i = i + 1)
            cycle(1'b1, 1'b0, $sformatf("reset_flush_%0d", i));

        for (i = 0; i < 20; i = i + 1)
            cycle(1'b1, (i % 2) != 0, $sformatf("alternating_%0d", i));

        // Reset a partially filled register to detect stale internal stages.
        cycle(1'b0, 1'b0, "partial_fill_start_reset");
        cycle(1'b1, 1'b1, "partial_fill_first");
        cycle(1'b1, 1'b1, "partial_fill_second");
        cycle(1'b0, 1'b1, "partial_fill_reset");
        for (i = 0; i < 6; i = i + 1)
            cycle(1'b1, 1'b0, $sformatf("partial_fill_flush_%0d", i));

        // Long uninterrupted random streams exercise all pipeline patterns.
        for (i = 0; i < 256; i = i + 1) begin
            random_in = $urandom_range(0, 1);
            cycle(1'b1, random_in, $sformatf("random_data_%0d", i));
        end
        // Mix single and consecutive reset cycles with random input data.
        for (i = 0; i < 256; i = i + 1) begin
            random_resetn = ($urandom_range(0, 7) != 0);
            random_in = $urandom_range(0, 1);
            cycle(random_resetn, random_in, $sformatf("random_reset_%0d", i));
        end
        for (i = 0; i < 5; i = i + 1)
            cycle(1'b1, 1'b0, $sformatf("final_drain_%0d", i));

        if (failures == 0)
            $display("PASS all_checks count=%0d", checks);
        else
            $display("FAIL all_checks expected=0 got=%0d inputs=checks:%0d",
                     failures, checks);
        $finish;
    end
endmodule
