`timescale 1ns/1ps

module tb_top;
    reg clk = 0;
    reg reset = 0;
    reg data = 0;
    reg ack = 0;
    wire [3:0] count;
    wire counting, done;

    TopModule dut (
        .clk(clk), .reset(reset), .data(data), .count(count),
        .counting(counting), .done(done), .ack(ack)
    );

    always #5 clk = ~clk;

    localparam SEARCH = 0, LOAD = 1, RUN = 2, WAIT_ACK = 3;
    integer state = SEARCH;
    integer prefix = 0;
    integer bits_loaded = 0;
    integer duration = 0;
    integer remaining = 0;
    integer clocks_left = 0;
    integer cycle = 0;
    integer failures = 0;
    integer d, j, trial;
    reg [31:0] rng = 32'h19ab73e5;
    reg [31:0] random_word;

    // Local deterministic PRNG: independent of simulator seed conventions.
    task randomize_word;
        begin
            rng = rng ^ (rng << 13);
            rng = rng ^ (rng >> 17);
            rng = rng ^ (rng << 5);
            random_word = rng;
        end
    endtask

    // Each call drives on a falling edge and checks after the next rising
    // edge, allowing nonblocking assignments in the DUT to settle.
    task step(input reg r, input reg b, input reg a, input string name);
        reg expected_counting, expected_done;
        begin
            @(negedge clk);
            reset = r;
            data = b;
            ack = a;
            @(posedge clk);
            if (r) begin
                state = SEARCH;
                prefix = 0;
                bits_loaded = 0;
                duration = 0;
                remaining = 0;
                clocks_left = 0;
            end else begin
                case (state)
                    SEARCH: begin
                        // Length of the longest suffix which is a prefix
                        // of 1101. In particular, 11101 must also match.
                        case (prefix)
                            0: if (b) prefix = 1;
                            1: if (b) prefix = 2; else prefix = 0;
                            2: if (b) prefix = 2; else prefix = 3;
                            3: begin
                                if (b) begin
                                    state = LOAD;
                                    bits_loaded = 0;
                                    duration = 0;
                                    prefix = 0;
                                end else prefix = 0;
                            end
                        endcase
                    end
                    LOAD: begin
                        duration = ((duration << 1) | b) & 15;
                        bits_loaded = bits_loaded + 1;
                        if (bits_loaded == 4) begin
                            state = RUN;
                            remaining = duration;
                            clocks_left = 1000;
                        end
                    end
                    RUN: begin
                        if (clocks_left == 1) begin
                            if (remaining == 0) state = WAIT_ACK;
                            else begin
                                remaining = remaining - 1;
                                clocks_left = 1000;
                            end
                        end else clocks_left = clocks_left - 1;
                    end
                    WAIT_ACK: begin
                        if (a) begin
                            state = SEARCH;
                            prefix = 0;
                        end
                    end
                endcase
            end
            #1;
            cycle = cycle + 1;
            expected_counting = (state == RUN);
            expected_done = (state == WAIT_ACK);
            // count is explicitly unspecified outside RUN.
            if ((counting !== expected_counting) ||
                (done !== expected_done) ||
                (expected_counting && (count !== remaining[3:0]))) begin
                failures = failures + 1;
                if (expected_counting)
                    $display("FAIL %s_cycle_%0d expected=counting:%b,done:%b,count:%0d got=counting:%b,done:%b,count:%b inputs=reset:%b,data:%b,ack:%b",
                        name, cycle, expected_counting, expected_done,
                        remaining, counting, done, count, reset, data, ack);
                else
                    $display("FAIL %s_cycle_%0d expected=counting:%b,done:%b,count:dc got=counting:%b,done:%b,count:%b inputs=reset:%b,data:%b,ack:%b",
                        name, cycle, expected_counting, expected_done,
                        counting, done, count, reset, data, ack);
            end else $display("PASS %s_cycle_%0d", name, cycle);
        end
    endtask

    task start_timer(input integer value);
        integer k;
        begin
            step(0, 1, 0, "start_1");
            step(0, 1, 1, "start_11_ack_ignored");
            step(0, 0, 0, "start_110");
            step(0, 1, 1, "start_1101_ack_ignored");
            for (k = 3; k >= 0; k = k - 1)
                step(0, (value >> k) & 1, k & 1, "load_msb_first");
        end
    endtask

    task finish_timer(input reg ack_at_expiry);
        integer k;
        begin
            // Bound the loop by the reference model, never by DUT outputs.
            while (state == RUN) begin
                randomize_word;
                step(0, random_word[0], ack_at_expiry ? 1'b1 : random_word[1],
                     "count_exact_cycles_ignore_data_and_ack");
            end
            // The expiry cycle must assert done even if ack is already high.
            if (!ack_at_expiry) begin
                for (k = 0; k < 17; k = k + 1) begin
                    randomize_word;
                    step(0, random_word[0], 0, "done_holds_until_ack");
                end
            end
            step(0, 1, 1, "acknowledge");
        end
    endtask

    initial begin
        step(1, 1, 1, "initial_synchronous_reset");
        step(1, 0, 0, "reset_held");
        for (j = 0; j < 8; j = j + 1)
            step(0, 0, j & 1, "idle_ack_does_not_start");

        // Every duration, including both boundaries, with random busy data
        // and ack. Each 1000-cycle plateau and its transition is checked.
        for (d = 0; d < 16; d = d + 1) begin
            start_timer(d);
            finish_timer(d & 1);
        end

        // Overlapping candidate prefixes: 11101 contains the start pattern.
        step(1, 0, 0, "overlap_reset");
        step(0, 1, 0, "overlap_1");
        step(0, 1, 0, "overlap_11");
        step(0, 1, 0, "overlap_111");
        step(0, 0, 0, "overlap_1110");
        step(0, 1, 0, "overlap_11101");
        for (j = 0; j < 4; j = j + 1)
            step(0, 0, 0, "overlap_delay_zero");
        finish_timer(0);

        // Random serial traffic exercises prefix fallback, delay acquisition,
        // data ignored while busy, and acknowledgement/restart sequences.
        for (trial = 0; trial < 4; trial = trial + 1) begin
            step(1, 0, 0, "random_stream_reset");
            for (j = 0; j < 18000; j = j + 1) begin
                randomize_word;
                step(0, random_word[0], random_word[1], "random_stream");
            end
        end

        // Reset discards each possible partial prefix and partial duration.
        for (d = 1; d <= 7; d = d + 1) begin
            step(1, 0, 0, "partial_reset_setup");
            for (j = 0; j < d; j = j + 1)
                step(0, (j == 2) ? 0 : 1, 0, "partial_pattern_or_payload");
            step(1, 1, 1, "reset_discards_partial_input");
            for (j = 0; j < 5; j = j + 1)
                step(0, 0, 0, "no_stale_partial_match");
            start_timer(0);
            finish_timer(0);
        end

        start_timer(15);
        for (j = 0; j < 1013; j = j + 1)
            step(0, j & 1, 0, "before_reset_mid_count");
        step(1, 1, 1, "reset_aborts_count");
        start_timer(0);
        while (state == RUN) step(0, 1, 0, "before_reset_done");
        step(1, 1, 0, "reset_clears_done_without_ack");
        start_timer(1);
        finish_timer(1);

        if (failures == 0) $display("PASS all_tests");
        else $display("FAIL all_tests expected=0 got=%0d inputs=see_failure_lines", failures);
        $finish;
    end
endmodule
