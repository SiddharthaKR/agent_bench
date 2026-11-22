`timescale 1ns/1ps

module tb_top;
    reg clk;
    reg L;
    reg q_in;
    reg r_in;
    wire Q;

    reg expected_q;
    reg model_valid;
    integer checks;
    integer failures;
    integer prior;
    integer vector_index;
    integer iteration;
    reg [31:0] random_state;

    TopModule dut (
        .clk(clk),
        .L(L),
        .q_in(q_in),
        .r_in(r_in),
        .Q(Q)
    );

    task automatic check_q(input string name);
        begin
            checks = checks + 1;
            if (Q === expected_q)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%b got=%b inputs=clk:%b,L:%b,q_in:%b,r_in:%b",
                         name, expected_q, Q, clk, L, q_in, r_in);
            end
        end
    endtask

    // Each call starts and ends with clk low. Input transitions are
    // separated from both clock edges, and checks follow NBA updates.
    task automatic cycle(
        input reg load_value,
        input reg q_value,
        input reg r_value,
        input string name
    );
        begin
            #2;
            L = load_value;
            q_in = q_value;
            r_in = r_value;
            #2;
            if (model_valid)
                check_q($sformatf("%s_low_hold", name));

            #1;
            clk = 1'b1;
            expected_q = load_value ? r_value : q_value;
            model_valid = 1'b1;
            #1;
            check_q($sformatf("%s_capture", name));

            // Changing every data/control input while clk is high must
            // not change the stored output (nor cause a second capture).
            #2;
            L = ~load_value;
            q_in = ~q_value;
            r_in = ~r_value;
            #1;
            check_q($sformatf("%s_high_hold", name));
            #1;
            clk = 1'b0;
            #1;
            check_q($sformatf("%s_falling_hold", name));
        end
    endtask

    initial begin
        clk = 1'b0;
        L = 1'b0;
        q_in = 1'b0;
        r_in = 1'b0;
        expected_q = 1'b0;
        model_valid = 1'b0;
        checks = 0;
        failures = 0;
        random_state = 32'h8f31_a5c7;

        // There is no reset or specified power-up value. Establish a
        // known state through the specified synchronous load operation.
        cycle(1'b1, 1'b1, 1'b0, "initialize_load_zero");
        cycle(1'b1, 1'b0, 1'b1, "load_one");
        cycle(1'b0, 1'b0, 1'b1, "shift_zero");
        cycle(1'b0, 1'b1, 1'b0, "shift_one");

        // All eight binary input combinations from each previous Q.
        // Re-establish the previous state before every combination.
        for (prior = 0; prior < 2; prior = prior + 1) begin
            for (vector_index = 0; vector_index < 8;
                 vector_index = vector_index + 1) begin
                cycle(1'b1, 1'b0, prior != 0,
                      $sformatf("seed_prior_%0d_vector_%0d", prior, vector_index));
                cycle(vector_index[2], vector_index[1], vector_index[0],
                      $sformatf("exhaustive_prior_%0d_vector_%0d", prior, vector_index));
            end
        end

        // Deterministic pseudorandom stimulus for reproducible sequences
        // of loads, shifts, repeated values, and transitions.
        for (iteration = 0; iteration < 512; iteration = iteration + 1) begin
            random_state = random_state ^ (random_state << 13);
            random_state = random_state ^ (random_state >> 17);
            random_state = random_state ^ (random_state << 5);
            cycle(random_state[0], random_state[1], random_state[2],
                  $sformatf("random_%0d", iteration));
        end

        if (failures == 0)
            $display("PASS summary checks=%0d failures=0", checks);
        else
            $display("FAIL summary expected=0 got=%0d inputs=completed_checks:%0d",
                     failures, checks);
        $finish;
    end
endmodule
