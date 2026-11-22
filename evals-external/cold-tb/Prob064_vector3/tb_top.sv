`timescale 1ns/1ps

module tb_top;
    reg [4:0] a, b, c, d, e, f;
    wire [7:0] w, x, y, z;
    integer checks = 0;
    integer failures = 0;
    integer i, field, value;
    reg [29:0] stimulus;
    reg [31:0] rng = 32'h6d2b79f5;

    TopModule dut (
        .a(a), .b(b), .c(c), .d(d), .e(e), .f(f),
        .w(w), .x(x), .y(y), .z(z)
    );

    task automatic check;
        input string name;
        input [29:0] inputs;
        reg [31:0] expected;
        reg [31:0] got;
        begin
            // The specification places a first, f last, then appends 11.
            // There are no clock or reset ports; allow combinational settling.
            {a, b, c, d, e, f} = inputs;
            expected = {inputs, 2'b11};
            #1;
            got = {w, x, y, z};
            checks = checks + 1;
            // Case inequality also catches unknown or undriven output bits.
            if (got !== expected) begin
                failures = failures + 1;
                $display("FAIL %s expected=%08h got=%08h inputs=a:%02h,b:%02h,c:%02h,d:%02h,e:%02h,f:%02h",
                         name, expected, got, a, b, c, d, e, f);
            end else begin
                $display("PASS %s", name);
            end
        end
    endtask

    initial begin
        check("all_zero", 30'b0);
        check("all_one", {30{1'b1}});
        check("alternating_10", {15{2'b10}});
        check("alternating_01", {15{2'b01}});
        check("distinct_fields", {5'd1, 5'd2, 5'd4, 5'd8, 5'd16, 5'd31});
        check("reverse_fields", {5'd31, 5'd16, 5'd8, 5'd4, 5'd2, 5'd1});

        // Every bit, including those adjacent to output-byte boundaries.
        for (i = 0; i < 30; i = i + 1) begin
            stimulus = 30'b1 << i;
            check($sformatf("walking_one_%0d", i), stimulus);
            check($sformatf("walking_zero_%0d", i), ~stimulus);
        end

        // Exhaust each five-bit field with all other fields held low/high.
        // Field 0 is f; field 5 is a.
        for (field = 0; field < 6; field = field + 1) begin
            for (value = 0; value < 32; value = value + 1) begin
                stimulus = 30'b0;
                stimulus[field*5 +: 5] = value[4:0];
                check($sformatf("field_%0d_value_%0d_zero_background", field, value), stimulus);
                stimulus = {30{1'b1}};
                stimulus[field*5 +: 5] = value[4:0];
                check($sformatf("field_%0d_value_%0d_one_background", field, value), stimulus);
            end
        end

        // Reproducible xorshift32 stimulus exercises simultaneous input changes.
        for (i = 0; i < 4096; i = i + 1) begin
            rng = rng ^ (rng << 13);
            rng = rng ^ (rng >> 17);
            rng = rng ^ (rng << 5);
            check($sformatf("random_%0d", i), rng[29:0]);
        end

        check("return_to_zero", 30'b0);
        check("return_to_one", {30{1'b1}});
        $display("SUMMARY checks=%0d failures=%0d", checks, failures);
        $finish;
    end
endmodule
