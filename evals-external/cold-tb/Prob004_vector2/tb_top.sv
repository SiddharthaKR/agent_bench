`timescale 1ns/1ps

module tb_top;
    reg  [31:0] in;
    wire [31:0] out;
    integer checks;
    integer failures;
    integer i, lane, value;
    reg [31:0] stimulus;
    reg [31:0] rng;

    TopModule dut (
        .in(in),
        .out(out)
    );

    task automatic check_word(input [31:0] word, input string name);
        reg [31:0] expected;
        integer b;
        begin
            // Output byte b is input byte 3-b; bits within a byte retain
            // their order. There are no clock or reset ports in the spec.
            for (b = 0; b < 4; b = b + 1)
                expected[b*8 +: 8] = word[(3-b)*8 +: 8];
            in = word;
            #1;
            checks = checks + 1;
            if (out === expected)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%08h got=%08h inputs=in:%08h",
                         name, expected, out, in);
            end
        end
    endtask

    initial begin
        checks = 0;
        failures = 0;
        in = 32'b0;
        rng = 32'hc0ffee17;

        check_word(32'h00000000, "all_zero");
        check_word(32'hffffffff, "all_one");
        check_word(32'h01234567, "distinct_bytes");
        check_word(32'h67452301, "reversed_distinct_bytes");
        check_word(32'h89abcdef, "high_bits_set");
        check_word(32'h018042a5, "asymmetric_bits_in_bytes");
        check_word(32'h55aa55aa, "alternating_bytes");
        check_word(32'haa55aa55, "opposite_alternating_bytes");
        check_word(32'h81818181, "identical_bytes");

        for (i = 0; i < 32; i = i + 1) begin
            check_word(32'h00000001 << i, $sformatf("walking_one_%0d", i));
            check_word(~(32'h00000001 << i), $sformatf("walking_zero_%0d", i));
        end

        // Exercise all byte values independently in every byte position,
        // against both zero and one backgrounds.
        for (lane = 0; lane < 4; lane = lane + 1) begin
            for (value = 0; value < 256; value = value + 1) begin
                stimulus = 32'h00000000;
                stimulus[lane*8 +: 8] = value[7:0];
                check_word(stimulus, $sformatf("byte_%0d_value_%0d_zero_bg", lane, value));
                stimulus = 32'hffffffff;
                stimulus[lane*8 +: 8] = value[7:0];
                check_word(stimulus, $sformatf("byte_%0d_value_%0d_one_bg", lane, value));
            end
        end

        // Fixed-seed xorshift32 gives reproducible full-width random words.
        for (i = 0; i < 2000; i = i + 1) begin
            rng = rng ^ (rng << 13);
            rng = rng ^ (rng >> 17);
            rng = rng ^ (rng << 5);
            check_word(rng, $sformatf("random_%0d", i));
        end

        // Return to boundary patterns after activity to expose stale outputs.
        check_word(32'h00000000, "final_zero");
        check_word(32'hffffffff, "final_one");
        check_word(32'h00000000, "final_zero_again");
        $display("SUMMARY checks=%0d failures=%0d", checks, failures);
        $finish;
    end
endmodule
