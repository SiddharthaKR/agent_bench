`timescale 1ns/1ps

module tb_top;
    reg clk = 1'b0;
    reg reset = 1'b0;
    reg w = 1'b0;
    wire z;

    TopModule dut (.clk(clk), .reset(reset), .w(w), .z(z));

    localparam integer A = 0, B = 1, C = 2, D = 3, E = 4, F = 5;
    integer model_state;
    integer checks = 0;
    integer failures = 0;
    integer s, bit_value, i;
    reg [31:0] rng = 32'h718ac52d;
    reg random_w, random_reset;

    always #5 clk = ~clk;

    // The spec does not explicitly define reset polarity or destination.
    // Use the conventional active-high reset to the first listed state, A.
    // Reset checks occur after rising edges, allowing either synchronous or
    // asynchronous active-high implementations.
    function automatic integer next_state(input integer state, input reg value);
        begin
            case (state)
                A: next_state = value ? A : B;
                B: next_state = value ? D : C;
                C: next_state = value ? D : E;
                D: next_state = value ? A : F;
                E: next_state = value ? D : E;
                F: next_state = value ? D : C;
                default: next_state = A;
            endcase
        end
    endfunction

    task automatic check_z(input string name);
        reg expected;
        begin
            expected = (model_state == E || model_state == F);
            checks = checks + 1;
            if (z === expected)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%b got=%b inputs=reset:%b,w:%b,clk:%b,model_state:%0d",
                         name, expected, z, reset, w, clk, model_state);
            end
        end
    endtask

    task automatic step(input reg reset_value, input reg w_value,
                        input string name);
        begin
            // All stimulus changes are on falling edges.
            @(negedge clk);
            reset = reset_value;
            w = w_value;
            #1;
            // Moore output must not change merely because w changes.
            // Skip this check while asserting reset: its timing is unspecified.
            if (!reset_value)
                check_z($sformatf("%s_before_rising_edge", name));
            @(posedge clk);
            if (reset_value)
                model_state = A;
            else
                model_state = next_state(model_state, w_value);
            #1;
            check_z($sformatf("%s_after_rising_edge", name));
        end
    endtask

    task automatic reach_state(input integer target);
        begin
            step(1'b1, 1'b0, $sformatf("setup_reset_for_state_%0d", target));
            case (target)
                A: begin end
                B: step(0, 0, "setup_A_to_B");
                C: begin
                    step(0, 0, "setup_A_to_B");
                    step(0, 0, "setup_B_to_C");
                end
                D: begin
                    step(0, 0, "setup_A_to_B");
                    step(0, 1, "setup_B_to_D");
                end
                E: begin
                    step(0, 0, "setup_A_to_B");
                    step(0, 0, "setup_B_to_C");
                    step(0, 0, "setup_C_to_E");
                end
                F: begin
                    step(0, 0, "setup_A_to_B");
                    step(0, 1, "setup_B_to_D");
                    step(0, 0, "setup_D_to_F");
                end
            endcase
        end
    endtask

    initial begin
        model_state = A;
        step(1, 0, "initial_reset");
        step(1, 1, "held_reset_with_w_high");
        step(1, 0, "held_reset_with_w_low");

        // Exercise every specified state/input transition. Follow each with
        // a common suffix so incorrect destinations with the same output
        // are distinguished by subsequent Moore outputs.
        for (s = A; s <= F; s = s + 1) begin
            for (bit_value = 0; bit_value < 2; bit_value = bit_value + 1) begin
                reach_state(s);
                step(0, bit_value != 0,
                     $sformatf("transition_state_%0d_w_%0d", s, bit_value));
                step(0, 0, "destination_probe_0");
                step(0, 0, "destination_probe_00");
                step(0, 1, "destination_probe_001");
                step(0, 0, "destination_probe_0010");
            end
            reach_state(s);
            step(1, 1, $sformatf("reset_from_state_%0d", s));
            step(0, 0, "reset_release_A_to_B");
            step(0, 0, "reset_release_B_to_C");
            step(0, 0, "reset_release_C_to_E");
        end

        reach_state(A);
        for (i = 0; i < 20; i = i + 1)
            step(0, 1, $sformatf("A_self_loop_%0d", i));
        for (i = 0; i < 25; i = i + 1)
            step(0, 0, $sformatf("zeros_to_E_and_hold_%0d", i));
        for (i = 0; i < 40; i = i + 1)
            step(0, (i % 2) != 0, $sformatf("alternating_%0d", i));

        // Deterministic xorshift stimulus, independent of simulator RNG state.
        for (i = 0; i < 1500; i = i + 1) begin
            rng = rng ^ (rng << 13);
            rng = rng ^ (rng >> 17);
            rng = rng ^ (rng << 5);
            random_w = rng[0];
            random_reset = (rng[8:1] == 8'h00);
            step(random_reset, random_w, $sformatf("random_%0d", i));
        end

        if (failures == 0)
            $display("PASS summary checks=%0d", checks);
        else
            $display("FAIL summary expected=0 got=%0d inputs=checks:%0d", failures, checks);
        $finish;
    end

    initial begin
        #100000;
        $display("FAIL watchdog expected=completion got=timeout inputs=reset:%b,w:%b,clk:%b",
                 reset, w, clk);
        $finish;
    end
endmodule
