`timescale 1ns/1ps

module tb_top;
    // The map labels the four input bits x[1] through x[4].
    reg [4:1] x;
    wire f;
    integer i;
    integer passes;
    integer failures;
    reg [31:0] random_state;

    TopModule dut (.x(x), .f(f));

    // Index the oracle in the exact row/column order printed in spec.md:
    // {row x[3]x[4], column x[1]x[2]}.
    // An X here denotes a specification don't-care, not an expected X output.
    function automatic expected_f(input [4:1] value);
        begin
            case ({value[3], value[4], value[1], value[2]})
                4'b0001: expected_f = 1'b0;
                4'b0100: expected_f = 1'b0;
                4'b0111: expected_f = 1'b1;
                4'b0110: expected_f = 1'b0;
                4'b1100: expected_f = 1'b1;
                4'b1101: expected_f = 1'b1;
                4'b1000: expected_f = 1'b1;
                4'b1001: expected_f = 1'b1;
                4'b1011: expected_f = 1'b0;
                default: expected_f = 1'bx;
            endcase
        end
    endfunction

    task automatic check(input [4:1] stimulus, input string name);
        reg expected;
        begin
            // This is combinational logic: there is no clock or reset port.
            // Separate input updates and observations to allow settling.
            x = stimulus;
            #5;
            expected = expected_f(stimulus);
            if (expected === 1'bx) begin
                $display("PASS %s inputs=x[4:1]=%b row=%b%b col=%b%b (don't-care)",
                         name, x, x[3], x[4], x[1], x[2]);
                passes = passes + 1;
            end else if (f === expected) begin
                $display("PASS %s", name);
                passes = passes + 1;
            end else begin
                $display("FAIL %s expected=%b got=%b inputs=x[4:1]=%b row=%b%b col=%b%b",
                         name, expected, f, x, x[3], x[4], x[1], x[2]);
                failures = failures + 1;
            end
            #5;
        end
    endtask

    initial begin
        passes = 0;
        failures = 0;
        random_state = 32'h53c91a27;
        x = 4'b0000;
        #1;

        // Every map cell, including both endpoint input patterns.
        for (i = 0; i < 16; i = i + 1)
            check(i[3:0], $sformatf("exhaustive_%0d", i));

        // Reverse traversal and complementary jumps exercise input transitions.
        for (i = 15; i >= 0; i = i - 1) begin
            check(i[3:0], $sformatf("reverse_%0d", i));
            check(~i[3:0], $sformatf("complement_%0d", i));
        end

        // Reproducible pseudorandom combinational stimulus (xorshift32).
        for (i = 0; i < 256; i = i + 1) begin
            random_state = random_state ^ (random_state << 13);
            random_state = random_state ^ (random_state >> 17);
            random_state = random_state ^ (random_state << 5);
            check(random_state[3:0], $sformatf("random_%0d", i));
        end

        if (failures == 0)
            $display("PASS summary checks=%0d", passes);
        else
            $display("FAIL summary expected=0 got=%0d inputs=all_test_vectors", failures);
        $finish;
    end
endmodule
