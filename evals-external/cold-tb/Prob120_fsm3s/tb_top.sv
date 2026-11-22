`timescale 1ns/1ps

module tb_top;
    reg clk = 1'b0;
    reg reset = 1'b0;
    reg in = 1'b0;
    wire out;

    TopModule dut (.clk(clk), .reset(reset), .in(in), .out(out));

    localparam integer A = 0, B = 1, C = 2, D = 3;
    integer state;
    integer previous_state;
    integer passes = 0;
    integer failures = 0;
    integer seed = 32'h35ab719d;
    integer random_word;
    integer i;
    reg initialized = 1'b0;

    always #5 clk = ~clk;

    // This reference model is the transition table in spec.md.
    function automatic integer next_state(input integer s, input reg x);
        case (s)
            A: next_state = x ? B : A;
            B: next_state = x ? B : C;
            C: next_state = x ? D : A;
            D: next_state = x ? B : C;
            default: next_state = A;
        endcase
    endfunction

    task automatic check_output(input string name, input reg expected);
        begin
            if (out === expected) begin
                $display("PASS %s", name);
                passes = passes + 1;
            end else begin
                $display("FAIL %s expected=%b got=%b inputs=clk:%b,reset:%b,in:%b,previous_state:%0d,reference_state:%0d",
                         name, expected, out, clk, reset, in,
                         previous_state, state);
                failures = failures + 1;
            end
        end
    endtask

    task automatic step(input reg rst, input reg x, input string name);
        begin
            @(negedge clk);
            #1;
            previous_state = state;
            reset = rst;
            in = x;
            #1;
            // Neither an input change nor synchronous reset may change the
            // Moore output before the next rising clock edge.
            if (initialized)
                check_output({name, "_before_edge"}, state == D);
            @(posedge clk);
            if (rst)
                state = A;
            else
                state = next_state(state, x);
            initialized = 1'b1;
            #1;
            check_output({name, "_after_edge"}, state == D);
        end
    endtask

    initial begin
        state = A;
        previous_state = A;
        step(1, 0, "initial_reset");
        step(1, 1, "held_reset_input_one");
        step(0, 0, "A_to_A");
        step(0, 1, "A_to_B");
        step(0, 1, "B_to_B");
        step(0, 0, "B_to_C");
        step(0, 1, "C_to_D");
        step(0, 1, "D_to_B");
        step(0, 0, "B_to_C_again");
        step(0, 0, "C_to_A");
        step(0, 1, "enter_B_for_D_zero");
        step(0, 0, "enter_C_for_D_zero");
        step(0, 1, "enter_D_for_D_zero");
        step(0, 0, "D_to_C");

        // Exercise reset from each state, including D where asynchronous
        // reset would incorrectly drop the output before the rising edge.
        step(1, 1, "reset_from_C");
        step(1, 0, "reset_from_A");
        step(0, 1, "enter_B_for_reset");
        step(1, 1, "reset_from_B");
        step(0, 1, "enter_B_before_reset_D");
        step(0, 0, "enter_C_before_reset_D");
        step(0, 1, "enter_D_before_reset_D");
        step(1, 0, "reset_from_D");
        step(1, 1, "reset_held_again");
        step(0, 1, "reset_release_to_B");

        // Repeat visits to D and alternate its two outgoing transitions.
        for (i = 0; i < 16; i = i + 1) begin
            step(1, 0, $sformatf("pulse_%0d_reset", i));
            step(0, 1, $sformatf("pulse_%0d_B", i));
            step(0, 0, $sformatf("pulse_%0d_C", i));
            step(0, 1, $sformatf("pulse_%0d_D", i));
            step(0, i[0], $sformatf("pulse_%0d_leave_D", i));
        end

        for (i = 0; i < 500; i = i + 1) begin
            random_word = $random(seed);
            step((random_word[7:4] == 4'b0000), random_word[0],
                 $sformatf("random_%0d", i));
        end
        step(1, 1, "final_reset");
        $display("SUMMARY passes=%0d failures=%0d", passes, failures);
        $finish;
    end
endmodule
