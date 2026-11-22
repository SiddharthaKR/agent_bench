`timescale 1ns/1ps

module tb_top;
    reg  [99:0] in;
    wire [99:0] out_both;
    wire [99:0] out_any;
    wire [99:0] out_different;

    reg [99:0] stimulus;
    integer i, j;
    integer checks = 0;
    integer failures = 0;

    TopModule dut (
        .in(in),
        .out_both(out_both),
        .out_any(out_any),
        .out_different(out_different)
    );

    task automatic check_output;
        input string name;
        input [99:0] expected;
        input [99:0] got;
        begin
            checks = checks + 1;
            if (got === expected)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%025h got=%025h inputs=in:%025h",
                         name, expected, got, in);
            end
        end
    endtask

    task automatic apply_and_check;
        input [99:0] value;
        input string name;
        reg [99:0] expected_both;
        reg [99:0] expected_any;
        reg [99:0] expected_different;
        integer bit_index;
        begin
            // This interface is purely combinational: there is no clock or reset.
            in = value;
            expected_both = 100'b0;
            expected_any = 100'b0;
            expected_different = 100'b0;
            for (bit_index = 0; bit_index < 100; bit_index = bit_index + 1) begin
                if (bit_index < 99)
                    expected_both[bit_index] = value[bit_index] & value[bit_index+1];
                if (bit_index > 0)
                    expected_any[bit_index] = value[bit_index] | value[bit_index-1];
                if (bit_index < 99)
                    expected_different[bit_index] = value[bit_index] ^ value[bit_index+1];
                else
                    expected_different[bit_index] = value[99] ^ value[0];
            end
            #1;
            check_output($sformatf("%s.out_both", name), expected_both, out_both);
            check_output($sformatf("%s.out_any", name), expected_any, out_any);
            check_output($sformatf("%s.out_different", name), expected_different, out_different);
        end
    endtask

    initial begin
        apply_and_check(100'b0, "all_zero");
        apply_and_check({100{1'b1}}, "all_one");
        apply_and_check({50{2'b01}}, "alternating_01");
        apply_and_check({50{2'b10}}, "alternating_10");

        // Isolate each position, including both ends, in both polarities.
        for (i = 0; i < 100; i = i + 1) begin
            stimulus = 100'b0;
            stimulus[i] = 1'b1;
            apply_and_check(stimulus, $sformatf("walking_one_%0d", i));
            apply_and_check(~stimulus, $sformatf("walking_zero_%0d", i));
        end

        // Adjacent pairs include the wraparound pair (99, 0).
        for (i = 0; i < 100; i = i + 1) begin
            stimulus = 100'b0;
            stimulus[i] = 1'b1;
            stimulus[(i+1)%100] = 1'b1;
            apply_and_check(stimulus, $sformatf("adjacent_ones_%0d", i));
            apply_and_check(~stimulus, $sformatf("adjacent_zeros_%0d", i));
        end

        // Exercise every possible two-hot input and its complement.
        for (i = 0; i < 100; i = i + 1) begin
            for (j = i + 1; j < 100; j = j + 1) begin
                stimulus = 100'b0;
                stimulus[i] = 1'b1;
                stimulus[j] = 1'b1;
                apply_and_check(stimulus, $sformatf("two_hot_%0d_%0d", i, j));
                apply_and_check(~stimulus, $sformatf("two_cold_%0d_%0d", i, j));
            end
        end

        // Generate all 100 bits independently, avoiding narrow random vectors.
        for (i = 0; i < 2000; i = i + 1) begin
            for (j = 0; j < 100; j = j + 1)
                stimulus[j] = $urandom_range(0, 1);
            apply_and_check(stimulus, $sformatf("random_%0d", i));
        end

        apply_and_check(100'b0, "return_to_zero");
        $display("SUMMARY checks=%0d failures=%0d", checks, failures);
        $finish;
    end
endmodule
