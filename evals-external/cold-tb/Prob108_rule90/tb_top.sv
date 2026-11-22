`timescale 1ns/1ps

module tb_top;
    reg clk = 1'b0;
    reg load = 1'b0;
    reg [511:0] data = 512'b0;
    wire [511:0] q;

    TopModule dut (.clk(clk), .load(load), .data(data), .q(q));

    always #5 clk = ~clk;

    reg [511:0] model;
    reg model_valid = 1'b0;
    integer checks = 0;
    integer failures = 0;
    integer i, j;
    reg [511:0] pattern;
    reg [511:0] stimulus;
    reg random_load;

    // The specification provides load, but no reset. Establish a known
    // state with load before checking q; power-up state is unspecified.
    function automatic [511:0] rule90(input [511:0] state);
        integer cell_index;
        reg left_cell, right_cell;
        begin
            for (cell_index = 0; cell_index < 512; cell_index = cell_index + 1) begin
                if (cell_index == 0)
                    left_cell = 1'b0;
                else
                    left_cell = state[cell_index - 1];
                if (cell_index == 511)
                    right_cell = 1'b0;
                else
                    right_cell = state[cell_index + 1];
                rule90[cell_index] = left_cell ^ right_cell;
            end
        end
    endfunction

    function automatic [511:0] random_state;
        integer word_index;
        begin
            for (word_index = 0; word_index < 16; word_index = word_index + 1)
                random_state[word_index * 32 +: 32] = $urandom;
        end
    endfunction

    task automatic check_q(input string name, input [511:0] expected);
        begin
            checks = checks + 1;
            if (q === expected)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%0128h got=%0128h inputs=clk:%b,load:%b,data:%0128h",
                         name, expected, q, clk, load, data);
            end
        end
    endtask

    task automatic step(input string name, input reg do_load,
                        input reg [511:0] new_data);
        reg [511:0] next_model;
        begin
            // All stimulus changes on the inactive edge. Check that neither
            // that edge nor changes to load/data update the registered output.
            @(negedge clk);
            load = do_load;
            data = new_data;
            #1;
            if (model_valid)
                check_q($sformatf("%s_hold", name), model);
            if (do_load)
                next_model = new_data;
            else
                next_model = rule90(model);
            @(posedge clk);
            #1; // Allow nonblocking assignments to settle.
            model = next_model;
            model_valid = 1'b1;
            check_q(name, model);
        end
    endtask

    initial begin
        step("initial_load_zero", 1'b1, 512'b0);
        repeat (4) step("zero_fixed_point", 1'b0, {512{1'b1}});

        step("load_all_ones", 1'b1, {512{1'b1}});
        repeat (8) step("ones_evolve_zero_boundaries", 1'b0, 512'b0);

        step("load_alternating_01", 1'b1, {256{2'b01}});
        repeat (6) step("alternating_01_evolve", 1'b0, random_state());
        step("load_alternating_10", 1'b1, {256{2'b10}});
        repeat (6) step("alternating_10_evolve", 1'b0, random_state());

        pattern = 512'b0;
        pattern[0] = 1'b1;
        pattern[511] = 1'b1;
        step("load_both_boundaries", 1'b1, pattern);
        repeat (520) step("boundary_propagation", 1'b0, random_state());

        // Exercise every cell as a source, including both boundary cells.
        for (i = 0; i < 512; i = i + 1) begin
            pattern = 512'b0;
            pattern[i] = 1'b1;
            step($sformatf("single_cell_%0d_load", i), 1'b1, pattern);
            for (j = 0; j < 3; j = j + 1)
                step($sformatf("single_cell_%0d_evolve_%0d", i, j),
                     1'b0, random_state());
        end

        // Consecutive loads must replace the evolving state on every edge.
        for (i = 0; i < 32; i = i + 1) begin
            stimulus = random_state();
            step($sformatf("consecutive_load_%0d", i), 1'b1, stimulus);
        end

        // Randomize all data bits, including when data must be ignored.
        for (i = 0; i < 1200; i = i + 1) begin
            stimulus = random_state();
            random_load = ($urandom_range(0, 7) == 0);
            step($sformatf("random_cycle_%0d", i), random_load, stimulus);
        end

        // Long uninterrupted evolution catches state-history errors.
        step("long_run_load", 1'b1, random_state());
        for (i = 0; i < 600; i = i + 1)
            step($sformatf("long_run_%0d", i), 1'b0, random_state());

        step("reload_zero", 1'b1, 512'b0);
        step("zero_after_reload", 1'b0, random_state());
        $display("SUMMARY checks=%0d failures=%0d", checks, failures);
        $finish;
    end
endmodule
