`timescale 1ns/1ps

module tb_top;
    reg clk;
    reg j;
    reg k;
    wire Q;

    TopModule dut (.clk(clk), .j(j), .k(k), .Q(Q));

    reg expected_q;
    reg state_known;
    reg [1:0] random_jk;
    integer cycles;
    integer checks;
    integer failures;
    integer old_state;
    integer combination;
    integer iteration;
    integer seed;
    integer random_value;

    task automatic check_q(input string name);
        begin
            checks = checks + 1;
            if (Q === expected_q)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%b got=%b inputs=clk:%b,j:%b,k:%b",
                         name, expected_q, Q, clk, j, k);
            end
        end
    endtask

    // Each cycle starts with clk low. Inputs change strictly between edges.
    // There is no reset port or specified power-up state. The first 01 edge
    // establishes a known state without making any initialization assumption.
    task automatic run_cycle(input reg next_j, input reg next_k,
                             input string name);
        begin
            cycles = cycles + 1;
            #2;
            j = next_j;
            k = next_k;
            #1;
            if (state_known)
                check_q($sformatf("%s_cycle%0d_low_input_change", name, cycles));

            #2;
            clk = 1'b1;
            case ({next_j, next_k})
                2'b00: expected_q = expected_q;
                2'b01: expected_q = 1'b0;
                2'b10: expected_q = 1'b1;
                2'b11: expected_q = ~expected_q;
            endcase
            state_known = 1'b1;
            #1; // Allow nonblocking assignments in the DUT to settle.
            check_q($sformatf("%s_cycle%0d_positive_edge", name, cycles));

            // Exercise sensitivity to J/K while the clock is already high.
            #1;
            j = ~next_j;
            k = ~next_k;
            #1;
            check_q($sformatf("%s_cycle%0d_high_input_change", name, cycles));

            #2;
            clk = 1'b0;
            #1;
            check_q($sformatf("%s_cycle%0d_negative_edge", name, cycles));
        end
    endtask

    initial begin
        clk = 1'b0;
        j = 1'b0;
        k = 1'b0;
        expected_q = 1'bx;
        state_known = 1'b0;
        cycles = 0;
        checks = 0;
        failures = 0;
        seed = 32'h31415926;

        run_cycle(1'b0, 1'b1, "initialize_by_clear");

        // Exhaust every truth-table row from each possible previous state.
        for (old_state = 0; old_state < 2; old_state = old_state + 1) begin
            for (combination = 0; combination < 4;
                 combination = combination + 1) begin
                run_cycle(old_state != 0, old_state == 0,
                          $sformatf("prepare_old%0d_row%0d", old_state, combination));
                run_cycle((combination & 2) != 0, (combination & 1) != 0,
                          $sformatf("truth_old%0d_row%0d", old_state, combination));
            end
        end

        // Consecutive toggles must use the immediately preceding Q.
        for (iteration = 0; iteration < 20; iteration = iteration + 1)
            run_cycle(1'b1, 1'b1, "consecutive_toggle");

        // Long holds at both levels and repeated clear/set operations.
        for (old_state = 0; old_state < 2; old_state = old_state + 1) begin
            for (iteration = 0; iteration < 4; iteration = iteration + 1)
                run_cycle(old_state != 0, old_state == 0, "repeated_force");
            for (iteration = 0; iteration < 12; iteration = iteration + 1)
                run_cycle(1'b0, 1'b0, "consecutive_hold");
        end

        // Reproducible random sequences exercise arbitrary state histories.
        for (iteration = 0; iteration < 256; iteration = iteration + 1) begin
            random_value = $random(seed);
            random_jk = random_value[1:0];
            run_cycle(random_jk[1], random_jk[0],
                      $sformatf("random%0d", iteration));
        end

        $display("SUMMARY checks=%0d failures=%0d cycles=%0d", checks, failures, cycles);
        $finish;
    end
endmodule
