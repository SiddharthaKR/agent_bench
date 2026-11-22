`timescale 1ns/1ps

module tb_top;
    reg  [2:0] a;
    reg  [2:0] b;
    wire [2:0] out_or_bitwise;
    wire       out_or_logical;
    wire [5:0] out_not;

    integer i, j, n;
    integer checks, failures;
    reg [31:0] rng;

    TopModule dut (
        .a(a),
        .b(b),
        .out_or_bitwise(out_or_bitwise),
        .out_or_logical(out_or_logical),
        .out_not(out_not)
    );

    // This interface is purely combinational: there is no clock or reset.
    // Every stimulus is held for a delay before checking settled outputs.
    task automatic check_case;
        input [2:0] av;
        input [2:0] bv;
        input string name;
        reg [2:0] expected_bitwise;
        reg       expected_logical;
        reg [5:0] expected_not;
        integer k;
        begin
            a = av;
            b = bv;
            for (k = 0; k < 3; k = k + 1) begin
                expected_bitwise[k] = av[k] | bv[k];
                expected_not[k] = ~av[k];
                expected_not[k+3] = ~bv[k];
            end
            expected_logical = (av != 3'b000) || (bv != 3'b000);
            #1;

            checks = checks + 1;
            if (out_or_bitwise === expected_bitwise)
                $display("PASS %s_bitwise", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s_bitwise expected=%b got=%b inputs=a:%b,b:%b",
                         name, expected_bitwise, out_or_bitwise, a, b);
            end

            checks = checks + 1;
            if (out_or_logical === expected_logical)
                $display("PASS %s_logical", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s_logical expected=%b got=%b inputs=a:%b,b:%b",
                         name, expected_logical, out_or_logical, a, b);
            end

            checks = checks + 1;
            if (out_not === expected_not)
                $display("PASS %s_not", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s_not expected=%b got=%b inputs=a:%b,b:%b",
                         name, expected_not, out_not, a, b);
            end
        end
    endtask

    initial begin
        a = 0;
        b = 0;
        checks = 0;
        failures = 0;
        rng = 32'h51a7c0de;

        check_case(3'b000, 3'b000, "both_zero");
        check_case(3'b111, 3'b111, "both_ones");
        check_case(3'b000, 3'b111, "only_b_nonzero");
        check_case(3'b111, 3'b000, "only_a_nonzero");
        check_case(3'b001, 3'b010, "disjoint_bits");
        check_case(3'b101, 3'b010, "complementary_bits");
        check_case(3'b010, 3'b101, "swapped_halves");

        // Exhaust every binary input combination, including single-bit inputs.
        for (i = 0; i < 8; i = i + 1)
            for (j = 0; j < 8; j = j + 1)
                check_case(i[2:0], j[2:0],
                           $sformatf("exhaustive_a%0d_b%0d", i, j));

        // Reproducible pseudorandom transitions after exhaustive coverage.
        for (n = 0; n < 256; n = n + 1) begin
            rng = rng ^ (rng << 13);
            rng = rng ^ (rng >> 17);
            rng = rng ^ (rng << 5);
            check_case(rng[2:0], rng[10:8], $sformatf("random_%0d", n));
        end

        check_case(3'b000, 3'b000, "return_to_zero");
        if (failures == 0)
            $display("PASS summary checks=%0d", checks);
        else
            $display("FAIL summary expected=0 got=%0d inputs=last_a:%b,last_b:%b checks=%0d",
                     failures, a, b, checks);
        $finish;
    end
endmodule
