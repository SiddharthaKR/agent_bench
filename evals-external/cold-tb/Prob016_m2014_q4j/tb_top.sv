`timescale 1ns/1ps

module tb_top;
    reg  [3:0] x;
    reg  [3:0] y;
    wire [4:0] sum;
    integer a, b, i;
    integer passes = 0;
    integer failures = 0;
    reg [3:0] random_x, random_y;

    TopModule dut (
        .x(x),
        .y(y),
        .sum(sum)
    );

    task automatic check_add(
        input string name,
        input reg [3:0] test_x,
        input reg [3:0] test_y
    );
        reg [4:0] expected;
        begin
            // There is no clock or reset in the specified interface.
            x = test_x;
            y = test_y;
            expected = {1'b0, test_x} + {1'b0, test_y};
            #1;
            if (sum !== expected) begin
                $display("FAIL %s expected=%0d got=%0d inputs=x:%0d,y:%0d",
                         name, expected, sum, x, y);
                failures = failures + 1;
            end else begin
                $display("PASS %s", name);
                passes = passes + 1;
            end
        end
    endtask

    initial begin
        check_add("zero",               4'd0,  4'd0);
        check_add("left_identity",      4'd0,  4'd15);
        check_add("right_identity",     4'd15, 4'd0);
        check_add("single_carry",       4'd1,  4'd1);
        check_add("carry_chain",        4'd7,  4'd1);
        check_add("overflow_chain",     4'd15, 4'd1);
        check_add("high_bit_overflow",  4'd8,  4'd8);
        check_add("maximum_sum",        4'd15, 4'd15);
        check_add("overflow_clears",    4'd0,  4'd0);

        // Exhaust all 256 binary input pairs, including every carry pattern.
        for (a = 0; a < 16; a = a + 1)
            for (b = 0; b < 16; b = b + 1)
                check_add($sformatf("exhaustive_%0d_%0d", a, b),
                          a[3:0], b[3:0]);

        // Random ordering also exercises arbitrary input transitions.
        for (i = 0; i < 256; i = i + 1) begin
            random_x = $urandom_range(0, 15);
            random_y = $urandom_range(0, 15);
            check_add($sformatf("random_%0d", i), random_x, random_y);
        end

        $display("SUMMARY passes=%0d failures=%0d", passes, failures);
        $finish;
    end
endmodule
