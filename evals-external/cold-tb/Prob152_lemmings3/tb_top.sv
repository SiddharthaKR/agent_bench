`timescale 1ns/1ps
module tb_top;
    reg clk = 0;
    reg areset = 0;
    reg bump_left = 0, bump_right = 0, ground = 1, dig = 0;
    wire walk_left, walk_right, aaah, digging;

    TopModule dut (
        .clk(clk), .areset(areset),
        .bump_left(bump_left), .bump_right(bump_right),
        .ground(ground), .dig(dig),
        .walk_left(walk_left), .walk_right(walk_right),
        .aaah(aaah), .digging(digging)
    );

    always #5 clk = ~clk;

    // Specification model: activity and the direction remembered through
    // digging/falling are independent pieces of state.
    localparam WALK = 0, FALL = 1, DIGGING = 2;
    integer activity = WALK;
    reg rightward = 0;
    integer checks = 0, failures = 0;
    integer state_index, vector_index, i;
    reg [31:0] rng = 32'h8e137a65;

    always @(posedge clk or posedge areset) begin
        if (areset) begin
            activity = WALK;
            rightward = 0;
        end else begin
            case (activity)
                WALK: begin
                    if (!ground)
                        activity = FALL;
                    else if (dig)
                        activity = DIGGING;
                    else if ((!rightward && bump_left) ||
                             (rightward && bump_right))
                        rightward = !rightward;
                end
                FALL: if (ground) activity = WALK;
                DIGGING: if (!ground) activity = FALL;
            endcase
        end
    end

    task automatic check_outputs(input string name);
        reg [3:0] expected, actual;
        begin
            expected = {activity == WALK && !rightward,
                        activity == WALK && rightward,
                        activity == FALL, activity == DIGGING};
            actual = {walk_left, walk_right, aaah, digging};
            checks = checks + 1;
            if (actual === expected)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%b got=%b inputs=areset:%b,bump_left:%b,bump_right:%b,ground:%b,dig:%b,clk:%b",
                         name, expected, actual, areset, bump_left,
                         bump_right, ground, dig, clk);
            end
        end
    endtask

    // All stimulus changes occur at least one time unit after a falling edge.
    // Checking before the next rising edge also verifies Moore output behavior.
    task automatic step(input reg bl, br, gr, di, input string name);
        begin
            @(negedge clk);
            #1;
            bump_left = bl;
            bump_right = br;
            ground = gr;
            dig = di;
            #1;
            check_outputs({name, "_before_edge"});
            @(posedge clk);
            #1;
            check_outputs({name, "_after_edge"});
        end
    endtask

    // A reset pulse entirely between rising edges must reset immediately.
    task automatic pulse_reset(input string name);
        begin
            @(negedge clk);
            #1;
            areset = 1;
            bump_left = 1;
            bump_right = 1;
            ground = 0;
            dig = 1;
            #1;
            check_outputs({name, "_asynchronous_assert"});
            #1;
            areset = 0;
            bump_left = 0;
            bump_right = 0;
            ground = 1;
            dig = 0;
            #1;
            check_outputs({name, "_asynchronous_release"});
            @(posedge clk);
            #1;
            check_outputs({name, "_first_clock"});
        end
    endtask

    // Establish each of the six specified combinations of activity/direction.
    task automatic prepare_state(input integer which);
        begin
            pulse_reset($sformatf("prepare_%0d", which));
            if (which % 2)
                step(1, 0, 1, 0, "prepare_right");
            case (which / 2)
                1: step(1, 1, 0, 1, "prepare_fall");
                2: step(1, 1, 1, 1, "prepare_dig");
            endcase
        end
    endtask

    initial begin
        pulse_reset("initial_reset");
        // Hold reset across clock edges with inputs requesting other behavior.
        @(negedge clk);
        #1;
        areset = 1;
        ground = 0;
        dig = 1;
        bump_left = 1;
        bump_right = 1;
        #1;
        check_outputs("held_reset_immediate");
        repeat (3) begin
            @(posedge clk);
            #1;
            check_outputs("held_reset_clock");
        end
        @(negedge clk);
        #1;
        areset = 0;
        #1;
        check_outputs("reset_release_preserves_walk_left_until_clock");
        @(posedge clk);
        #1;
        check_outputs("fall_after_reset_release");

        // Exhaust every input combination from every state. Each transition is
        // followed by landing and another walking cycle to expose lost direction.
        for (state_index = 0; state_index < 6; state_index = state_index + 1) begin
            for (vector_index = 0; vector_index < 16; vector_index = vector_index + 1) begin
                prepare_state(state_index);
                step(vector_index[3], vector_index[2], vector_index[1], vector_index[0],
                     $sformatf("state_%0d_vector_%0d", state_index, vector_index));
                step(0, 0, 0, 0, "follow_through_no_ground");
                step(1, 1, 1, 1, "landing_ignores_bumps_and_dig");
                step(0, 0, 1, 0, "remembered_direction");
            end
        end

        // Explicit long digging and falling intervals, in both directions,
        // with continuously changing ignored commands.
        for (state_index = 0; state_index < 2; state_index = state_index + 1) begin
            prepare_state(state_index);
            step(1, 1, 1, 1, "dig_overrides_bump");
            repeat (12) step(1, 1, 1, 0, "dig_persists_without_command");
            step(1, 1, 0, 1, "dig_breakthrough");
            repeat (24) step(1, 1, 0, 1, "long_fall_ignores_commands");
            step(1, 1, 1, 1, "land_with_all_commands");
            step(0, 0, 1, 1, "dig_after_landing");
            pulse_reset("reset_while_digging");
            step(1, 1, 0, 1, "enter_fall_for_reset");
            pulse_reset("reset_while_falling");
        end
        prepare_state(1);
        pulse_reset("reset_while_walking_right");

        // Deterministic pseudo-random stimulus, including bursts biased toward
        // grounded walking and frequent reset pulses.
        for (i = 0; i < 1000; i = i + 1) begin
            rng = rng ^ (rng << 13);
            rng = rng ^ (rng >> 17);
            rng = rng ^ (rng << 5);
            step(rng[0], rng[7], rng[16] | rng[25], rng[11] & rng[23],
                 $sformatf("random_%0d", i));
            if ((i % 97) == 96)
                pulse_reset($sformatf("random_reset_%0d", i));
        end
        $display("SUMMARY checks=%0d failures=%0d", checks, failures);
        $finish;
    end

    initial begin
        #200000;
        $display("FAIL watchdog expected=completion got=timeout inputs=areset:%b,bump_left:%b,bump_right:%b,ground:%b,dig:%b",
                 areset, bump_left, bump_right, ground, dig);
        $finish;
    end
endmodule
