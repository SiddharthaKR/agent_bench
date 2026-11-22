`timescale 1ns/1ps

module tb_top;
    reg [99:0] in;
    wire out_and, out_or, out_xor;
    integer i, j, n;
    integer checks = 0;
    integer failures = 0;
    reg [99:0] stimulus;

    TopModule dut (
        .in(in),
        .out_and(out_and),
        .out_or(out_or),
        .out_xor(out_xor)
    );

    task automatic check_output;
        input string name;
        input expected_value;
        input actual_value;
        begin
            checks = checks + 1;
            if (actual_value === expected_value)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%b got=%b inputs=in:%025h",
                         name, expected_value, actual_value, in);
            end
        end
    endtask

    task automatic apply_and_check;
        input [99:0] value;
        input string name;
        reg expected_and, expected_or, expected_xor;
        integer bit_index;
        begin
            // No clock or reset exists in the specified interface.
            // Separate input changes and output sampling with settling time.
            in = value;
            expected_and = 1'b1;
            expected_or = 1'b0;
            expected_xor = 1'b0;
            for (bit_index = 0; bit_index < 100; bit_index = bit_index + 1) begin
                expected_and = expected_and & value[bit_index];
                expected_or = expected_or | value[bit_index];
                expected_xor = expected_xor ^ value[bit_index];
            end
            #5;
            check_output({name, ".out_and"}, expected_and, out_and);
            check_output({name, ".out_or"}, expected_or, out_or);
            check_output({name, ".out_xor"}, expected_xor, out_xor);
        end
    endtask

    initial begin
        apply_and_check(100'b0, "all_zero");
        apply_and_check({100{1'b1}}, "all_one_even_parity");
        apply_and_check(100'b0, "return_to_zero");

        for (i = 0; i < 100; i = i + 1) begin
            stimulus = 100'b0;
            stimulus[i] = 1'b1;
            apply_and_check(stimulus, $sformatf("walking_one_%0d", i));
            apply_and_check(~stimulus, $sformatf("walking_zero_%0d", i));
        end

        // Every distinct pair exercises even parity across all bit positions.
        for (i = 0; i < 100; i = i + 1) begin
            for (j = i + 1; j < 100; j = j + 1) begin
                stimulus = 100'b0;
                stimulus[i] = 1'b1;
                stimulus[j] = 1'b1;
                apply_and_check(stimulus, $sformatf("two_ones_%0d_%0d", i, j));
                apply_and_check(~stimulus, $sformatf("two_zeros_%0d_%0d", i, j));
            end
        end

        apply_and_check({50{2'b01}}, "alternating_01");
        apply_and_check({50{2'b10}}, "alternating_10");
        for (n = 0; n < 1000; n = n + 1) begin
            for (i = 0; i < 100; i = i + 1)
                stimulus[i] = $urandom_range(0, 1);
            apply_and_check(stimulus, $sformatf("random_%0d", n));
        end

        apply_and_check({100{1'b1}}, "final_all_one");
        apply_and_check(100'b0, "final_all_zero");
        $display("SUMMARY checks=%0d failures=%0d", checks, failures);
        $finish;
    end
endmodule
