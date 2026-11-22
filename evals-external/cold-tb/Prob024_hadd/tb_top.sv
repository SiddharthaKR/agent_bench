`timescale 1ns/1ps

module tb_top;
    reg a;
    reg b;
    wire sum;
    wire cout;
    integer i;
    integer failures;

    TopModule dut (
        .a(a),
        .b(b),
        .sum(sum),
        .cout(cout)
    );

    task automatic check_half_adder;
        input reg next_a;
        input reg next_b;
        input string name;
        reg [1:0] expected;
        begin
            // The specification has no clock or reset. Allow propagation
            // time after each input change before checking both outputs.
            a = next_a;
            b = next_b;
            expected = {1'b0, next_a} + {1'b0, next_b};
            #1;
            if ({cout, sum} === expected)
                $display("PASS %s", name);
            else begin
                $display("FAIL %s expected=%02b got=%02b inputs=a=%b,b=%b",
                         name, expected, {cout, sum}, a, b);
                failures = failures + 1;
            end
        end
    endtask

    initial begin
        failures = 0;
        a = 1'b0;
        b = 1'b0;

        // Exhaustive binary truth table, including zero and carry cases.
        check_half_adder(1'b0, 1'b0, "zero_plus_zero");
        check_half_adder(1'b0, 1'b1, "zero_plus_one");
        check_half_adder(1'b1, 1'b0, "one_plus_zero");
        check_half_adder(1'b1, 1'b1, "one_plus_one_carry");

        // Every ordered transition between binary input combinations,
        // including unchanged inputs and simultaneous changes of both bits.
        for (i = 0; i < 16; i = i + 1) begin
            check_half_adder((i >> 3) & 1, (i >> 2) & 1,
                             $sformatf("transition_%0d_source", i));
            check_half_adder((i >> 1) & 1, i & 1,
                             $sformatf("transition_%0d_destination", i));
        end

        for (i = 0; i < 256; i = i + 1)
            check_half_adder($urandom_range(0, 1), $urandom_range(0, 1),
                             $sformatf("random_%0d", i));

        if (failures == 0)
            $display("PASS all_checks");
        else
            $display("FAIL all_checks expected=0 got=%0d inputs=all_test_vectors",
                     failures);
        $finish;
    end
endmodule
