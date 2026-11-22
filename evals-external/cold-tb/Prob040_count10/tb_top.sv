`timescale 1ns/1ps
module tb_top;
    reg clk;
    reg reset;
    wire [3:0] q;
    reg [3:0] expected;
    integer failures;
    integer checks;
    integer i;
    integer seed;
    integer random_value;

    TopModule dut (
        .clk(clk),
        .reset(reset),
        .q(q)
    );

    initial clk = 1'b0;
    always #5 clk = ~clk;

    // Specification model: reset has priority; otherwise count modulo ten.
    function automatic [3:0] next_count(input [3:0] current);
        begin
            next_count = (current == 4'd9) ? 4'd0 : current + 4'd1;
        end
    endfunction

    task automatic check_q(input string name);
        begin
            checks = checks + 1;
            if (q === expected)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%0d got=%0d inputs=clk:%b,reset:%b",
                         name, expected, q, clk, reset);
            end
        end
    endtask

    task automatic cycle(input bit reset_value, input string name);
        begin
            // Change reset half a cycle before the active edge.
            @(negedge clk);
            reset = reset_value;
            #1;
            check_q($sformatf("%s_before_posedge", name));
            @(posedge clk);
            if (reset_value)
                expected = 4'd0;
            else
                expected = next_count(expected);
            #1; // Allow nonblocking assignments to settle.
            check_q($sformatf("%s_after_posedge", name));
        end
    endtask

    task automatic between_edges_reset_pulse(input string name);
        begin
            // Entire pulse lies between positive edges: synchronous reset
            // must neither change q immediately nor affect the next count.
            @(negedge clk);
            #1 reset = 1'b1;
            #1 check_q($sformatf("%s_asserted", name));
            #1 reset = 1'b0;
            #1 check_q($sformatf("%s_deasserted", name));
            @(posedge clk);
            expected = next_count(expected);
            #1 check_q($sformatf("%s_next_count", name));
        end
    endtask

    initial begin
        failures = 0;
        checks = 0;
        seed = 32'h13579bdf;
        reset = 1'b1;
        expected = 4'd0;

        // No assumption is made about q before the first sampled reset.
        @(posedge clk);
        #1 check_q("initial_synchronous_reset");
        cycle(1'b1, "held_reset_1");
        cycle(1'b1, "held_reset_2");

        // Six complete periods check every legal state and repeated wraparound.
        for (i = 0; i < 60; i = i + 1)
            cycle(1'b0, $sformatf("uninterrupted_count_%0d", i));

        // Reach nine and verify reset wins over the ordinary wrap transition.
        for (i = 0; i < 9; i = i + 1)
            cycle(1'b0, $sformatf("reach_nine_%0d", i));
        cycle(1'b1, "reset_at_nine");

        // Assert sampled reset from each possible counter value, including zero.
        for (i = 0; i < 10; i = i + 1) begin : reset_each_state
            integer j;
            for (j = 0; j < i; j = j + 1)
                cycle(1'b0, $sformatf("reach_state_%0d_step_%0d", i, j));
            cycle(1'b1, $sformatf("reset_from_state_%0d", i));
        end

        cycle(1'b0, "pulse_setup_1");
        cycle(1'b0, "pulse_setup_2");
        between_edges_reset_pulse("unsampled_reset_nonzero");

        // Repeatability and irregular reset spacing exercise arbitrary histories.
        for (i = 0; i < 250; i = i + 1) begin
            random_value = $random(seed);
            cycle((random_value & 7) == 0,
                  $sformatf("random_cycle_%0d", i));
        end
        cycle(1'b1, "final_reset");
        cycle(1'b0, "first_count_after_final_reset");
        $display("SUMMARY checks=%0d failures=%0d", checks, failures);
        $finish;
    end
endmodule
