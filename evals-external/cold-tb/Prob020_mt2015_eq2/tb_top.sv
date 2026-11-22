`timescale 1ns/1ps

module tb_top;
    reg [1:0] A;
    reg [1:0] B;
    wire z;
    integer a_value;
    integer b_value;
    integer trial;

    TopModule dut (
        .A(A),
        .B(B),
        .z(z)
    );

    task automatic check_case;
        input [1:0] a_input;
        input [1:0] b_input;
        input string name;
        reg expected;
        begin
            // This interface is combinational: there is no clock or reset.
            A = a_input;
            B = b_input;
            expected = (a_input == b_input);
            #1;
            if (z === expected)
                $display("PASS %s", name);
            else
                $display("FAIL %s expected=%b got=%b inputs=A:%b B:%b",
                         name, expected, z, A, B);
        end
    endtask

    initial begin
        A = 2'b00;
        B = 2'b00;

        // Exhaust every specified binary input combination, including all
        // equal pairs, zero/maximum values, and single-bit differences.
        for (a_value = 0; a_value < 4; a_value = a_value + 1)
            for (b_value = 0; b_value < 4; b_value = b_value + 1)
                check_case(a_value[1:0], b_value[1:0],
                           $sformatf("exhaustive_A%0d_B%0d", a_value, b_value));

        // Exercise changes between equality and inequality repeatedly.
        for (trial = 0; trial < 256; trial = trial + 1)
            check_case($urandom_range(0, 3), $urandom_range(0, 3),
                       $sformatf("random_%0d", trial));

        $finish;
    end
endmodule
