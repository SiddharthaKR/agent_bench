`timescale 1ns/1ps

module tb_top;
    reg clk = 1'b0;
    reg load = 1'b0;
    reg [255:0] data = 256'b0;
    wire [255:0] q;

    TopModule dut (.clk(clk), .load(load), .data(data), .q(q));

    always #5 clk = ~clk;

    reg [255:0] model;
    reg model_valid = 1'b0;
    integer checks = 0;
    integer failures = 0;
    reg [31:0] rng = 32'h6d2b79f5;

    // The reference uses row/column coordinates and the eight offsets
    // specified for the torus; it never uses the DUT output as state.
    function automatic [255:0] next_generation(input [255:0] board);
        integer row, col, dr, dc, nr, nc, neighbors;
        begin
            next_generation = 256'b0;
            for (row = 0; row < 16; row = row + 1) begin
                for (col = 0; col < 16; col = col + 1) begin
                    neighbors = 0;
                    for (dr = -1; dr <= 1; dr = dr + 1)
                        for (dc = -1; dc <= 1; dc = dc + 1)
                            if ((dr != 0) || (dc != 0)) begin
                                nr = (row + dr + 16) % 16;
                                nc = (col + dc + 16) % 16;
                                if (board[nr*16 + nc])
                                    neighbors = neighbors + 1;
                            end
                    case (neighbors)
                        2: next_generation[row*16 + col] = board[row*16 + col];
                        3: next_generation[row*16 + col] = 1'b1;
                        default: next_generation[row*16 + col] = 1'b0;
                    endcase
                end
            end
        end
    endfunction

    function automatic [31:0] random_word(input [31:0] seed);
        reg [31:0] x;
        begin
            x = seed ^ (seed << 13);
            x = x ^ (x >> 17);
            random_word = x ^ (x << 5);
        end
    endfunction

    task automatic random_board(output reg [255:0] board);
        integer word_index;
        begin
            for (word_index = 0; word_index < 8; word_index = word_index + 1) begin
                rng = random_word(rng);
                board[word_index*32 +: 32] = rng;
            end
        end
    endtask

    task automatic check_board(input string name, input [255:0] expected);
        begin
            checks = checks + 1;
            if (q === expected)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%064h got=%064h inputs=clk:%b,load:%b,data:%064h,prior_state:%064h",
                         name, expected, q, clk, load, data, model);
            end
        end
    endtask

    // All stimulus changes occur after a falling edge. The hold check also
    // detects updates on falling edges and asynchronous load behavior.
    task automatic cycle(input string name, input bit do_load,
                         input [255:0] payload);
        reg [255:0] expected;
        begin
            @(negedge clk);
            #1;
            load = do_load;
            data = payload;
            expected = do_load ? payload : next_generation(model);
            #1;
            if (model_valid)
                check_board($sformatf("%s_hold_before_rising_edge", name), model);
            @(posedge clk);
            #1;
            check_board(name, expected);
            model = expected;
            model_valid = 1'b1;
        end
    endtask

    reg [255:0] board, noise;
    integer row, col, count, alive, dr, dc, slot, rotation;
    integer trial, step_index, bit_index;

    initial begin
        model = 256'b0;

        // No reset port is specified. Initialize only through synchronous load.
        cycle("load_empty", 1'b1, 256'b0);
        cycle("empty_stays_empty", 1'b0, {256{1'b1}});
        cycle("load_full", 1'b1, {256{1'b1}});
        cycle("full_dies_from_overcrowding", 1'b0, 256'b0);
        cycle("full_then_empty_remains_empty", 1'b0, {256{1'b1}});

        // Consecutive loads must replace the entire board, with priority over
        // evolution. Walking bits exercise every data/q position.
        for (bit_index = 0; bit_index < 256; bit_index = bit_index + 1) begin
            board = 256'b0;
            board[bit_index] = 1'b1;
            cycle($sformatf("walking_one_load_%0d", bit_index), 1'b1, board);
        end
        cycle("last_isolated_cell_dies", 1'b0, 256'b0);
        for (bit_index = 0; bit_index < 256; bit_index = bit_index + 1) begin
            board = {256{1'b1}};
            board[bit_index] = 1'b0;
            cycle($sformatf("walking_zero_load_%0d", bit_index), 1'b1, board);
        end
        cycle("dense_board_evolves", 1'b0, 256'b0);

        // For every cell, exercise all nine neighbor counts with the center
        // both dead and alive. Rotate which offsets are populated so that
        // partial neighborhoods vary across the board, including every seam.
        for (row = 0; row < 16; row = row + 1)
            for (col = 0; col < 16; col = col + 1)
                for (alive = 0; alive <= 1; alive = alive + 1)
                    for (count = 0; count <= 8; count = count + 1) begin
                        board = 256'b0;
                        board[row*16 + col] = (alive != 0);
                        slot = 0;
                        rotation = (row*3 + col*5 + alive) % 8;
                        for (dr = -1; dr <= 1; dr = dr + 1)
                            for (dc = -1; dc <= 1; dc = dc + 1)
                                if ((dr != 0) || (dc != 0)) begin
                                    if (((slot + rotation) % 8) < count)
                                        board[((row+dr+16)%16)*16 + ((col+dc+16)%16)] = 1'b1;
                                    slot = slot + 1;
                                end
                        cycle($sformatf("neighborhood_load_r%0d_c%0d_alive%0d_n%0d",
                                       row, col, alive, count), 1'b1, board);
                        cycle($sformatf("neighborhood_step_r%0d_c%0d_alive%0d_n%0d",
                                       row, col, alive, count), 1'b0, ~board);
                    end

        // A stable block spanning both wrap seams.
        board = 256'b0;
        board[0] = 1'b1;
        board[15] = 1'b1;
        board[240] = 1'b1;
        board[255] = 1'b1;
        cycle("corner_block_load", 1'b1, board);
        for (step_index = 0; step_index < 8; step_index = step_index + 1)
            cycle($sformatf("corner_block_step_%0d", step_index), 1'b0, ~board);

        // A blinker crossing the left/right seam changes orientation and back.
        board = 256'b0;
        board[8*16+15] = 1'b1;
        board[8*16] = 1'b1;
        board[8*16+1] = 1'b1;
        cycle("seam_blinker_load", 1'b1, board);
        for (step_index = 0; step_index < 12; step_index = step_index + 1)
            cycle($sformatf("seam_blinker_step_%0d", step_index), 1'b0, ~board);

        // A glider initially straddling both seams exercises multiple timesteps.
        board = 256'b0;
        board[15*16] = 1'b1;
        board[1] = 1'b1;
        board[16+15] = 1'b1;
        board[16] = 1'b1;
        board[17] = 1'b1;
        cycle("wrapped_glider_load", 1'b1, board);
        for (step_index = 0; step_index < 80; step_index = step_index + 1) begin
            random_board(noise);
            cycle($sformatf("wrapped_glider_step_%0d", step_index), 1'b0, noise);
        end

        // Independent random loads plus long evolving sequences at different
        // densities. Random data during evolution must have no effect.
        for (trial = 0; trial < 120; trial = trial + 1) begin
            random_board(board);
            random_board(noise);
            case (trial % 3)
                0: board = board & noise;
                1: board = board | noise;
                default: board = board;
            endcase
            cycle($sformatf("random_load_%0d", trial), 1'b1, board);
            for (step_index = 0; step_index < 12; step_index = step_index + 1) begin
                random_board(noise);
                cycle($sformatf("random_trial_%0d_step_%0d", trial, step_index),
                      1'b0, noise);
            end
        end

        $display("SUMMARY checks=%0d failures=%0d", checks, failures);
        $finish;
    end
endmodule
