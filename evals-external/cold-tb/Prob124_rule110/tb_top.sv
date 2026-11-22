`timescale 1ns/1ps

module tb_top;
    reg clk = 1'b0;
    reg load = 1'b0;
    reg [511:0] data = 512'b0;
    wire [511:0] q;

    TopModule dut (.clk(clk), .load(load), .data(data), .q(q));

    always #5 clk = ~clk;

    reg [511:0] model;
    reg initialized = 1'b0;
    integer checks = 0;
    integer failures = 0;
    integer i, j, pattern;
    reg [511:0] stimulus;
    reg random_load;

    // The specification has no reset. A synchronous load initializes state.
    function automatic [511:0] evolve(input [511:0] state);
        integer cell_index;
        reg left_cell, right_cell;
        begin
            for (cell_index = 0; cell_index < 512;
                 cell_index = cell_index + 1) begin
                left_cell = 1'b0;
                right_cell = 1'b0;
                if (cell_index < 511)
                    left_cell = state[cell_index + 1];
                if (cell_index > 0)
                    right_cell = state[cell_index - 1];
                case ({left_cell, state[cell_index], right_cell})
                    3'b111: evolve[cell_index] = 1'b0;
                    3'b110: evolve[cell_index] = 1'b1;
                    3'b101: evolve[cell_index] = 1'b1;
                    3'b100: evolve[cell_index] = 1'b0;
                    3'b011: evolve[cell_index] = 1'b1;
                    3'b010: evolve[cell_index] = 1'b1;
                    3'b001: evolve[cell_index] = 1'b1;
                    3'b000: evolve[cell_index] = 1'b0;
                    default: evolve[cell_index] = 1'bx;
                endcase
            end
        end
    endfunction

    function automatic [511:0] random_state;
        integer word_index;
        begin
            for (word_index = 0; word_index < 16; word_index = word_index + 1)
                random_state[word_index*32 +: 32] = $urandom;
        end
    endfunction

    task automatic check_state(input string name, input [511:0] expected);
        begin
            checks = checks + 1;
            if (q !== expected) begin
                failures = failures + 1;
                $display("FAIL %s expected=%h got=%h inputs=clk:%b,load:%b,data:%h,previous_state:%h",
                         name, expected, q, clk, load, data, model);
            end else
                $display("PASS %s", name);
        end
    endtask

    task automatic cycle(input string name, input reg do_load,
                         input [511:0] new_data);
        reg [511:0] expected;
        begin
            // Change both control and data only on the falling edge.
            @(negedge clk);
            load = do_load;
            data = new_data;
            if (do_load)
                expected = new_data;
            else
                expected = evolve(model);
            #1;
            if (initialized)
                check_state({name, "_before_posedge"}, model);
            @(posedge clk);
            #1; // Allow nonblocking sequential assignments to settle.
            check_state({name, "_after_posedge"}, expected);
            model = expected;
            initialized = 1'b1;
            @(negedge clk);
            #1;
            check_state({name, "_after_negedge"}, model);
        end
    endtask

    initial begin
        model = 512'b0;
        cycle("initialize_zero", 1'b1, 512'b0);
        repeat (4) cycle("zero_fixed_point_data_ignored", 1'b0, random_state());

        cycle("load_all_ones", 1'b1, {512{1'b1}});
        repeat (8) cycle("ones_boundary_evolution", 1'b0, random_state());
        cycle("consecutive_load_zero", 1'b1, 512'b0);
        cycle("consecutive_load_ones", 1'b1, {512{1'b1}});
        cycle("consecutive_load_alternating", 1'b1, {256{2'b10}});
        repeat (16) cycle("alternating_10_evolution", 1'b0, random_state());
        cycle("load_alternating_01", 1'b1, {256{2'b01}});
        repeat (16) cycle("alternating_01_evolution", 1'b0, random_state());

        // Exercise all eight local truth-table entries away from boundaries.
        for (pattern = 0; pattern < 8; pattern = pattern + 1) begin
            stimulus = 512'b0;
            stimulus[256:254] = pattern[2:0];
            cycle($sformatf("triplet_%03b_load", pattern[2:0]), 1'b1, stimulus);
            cycle($sformatf("triplet_%03b_step", pattern[2:0]), 1'b0, ~stimulus);
        end

        // Every bit position, including both zero-padded boundaries.
        for (i = 0; i < 512; i = i + 1) begin
            stimulus = 512'b0;
            stimulus[i] = 1'b1;
            cycle($sformatf("single_one_%0d_load", i), 1'b1, stimulus);
            cycle($sformatf("single_one_%0d_step", i), 1'b0, ~stimulus);
            cycle($sformatf("single_zero_%0d_load", i), 1'b1, ~stimulus);
            cycle($sformatf("single_zero_%0d_step", i), 1'b0, stimulus);
        end

        // Long trajectories expose errors that only emerge after many steps.
        stimulus = 512'b0;
        stimulus[511] = 1'b1;
        cycle("left_boundary_seed", 1'b1, stimulus);
        for (i = 0; i < 520; i = i + 1)
            cycle($sformatf("left_seed_step_%0d", i), 1'b0, random_state());
        stimulus = 512'b0;
        stimulus[0] = 1'b1;
        cycle("right_boundary_seed", 1'b1, stimulus);
        repeat (16) cycle("right_seed_evolution", 1'b0, random_state());

        for (i = 0; i < 100; i = i + 1) begin
            cycle($sformatf("random_load_%0d", i), 1'b1, random_state());
            for (j = 0; j < 12; j = j + 1)
                cycle($sformatf("random_evolve_%0d_%0d", i, j),
                      1'b0, random_state());
        end
        for (i = 0; i < 300; i = i + 1) begin
            random_load = ($urandom_range(0, 3) == 0);
            cycle($sformatf("mixed_load_%0d", i), random_load, random_state());
        end

        $display("SUMMARY checks=%0d failures=%0d", checks, failures);
        $finish;
    end
endmodule
