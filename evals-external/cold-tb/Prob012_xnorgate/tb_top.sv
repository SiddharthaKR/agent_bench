`timescale 1ns/1ps

module tb_top;
    reg a;
    reg b;
    wire out;
    integer i;
    integer failures;
    reg expected;

    TopModule dut (
        .a(a),
        .b(b),
        .out(out)
    );

    // No clock or reset is specified: allow combinational settling
    // between every input change and its corresponding check.
    task automatic check;
        input [255:0] name;
        input test_a;
        input test_b;
        reg want;
        begin
            a = test_a;
            b = test_b;
            // XNOR is high exactly when the two binary inputs agree.
            want = (test_a == test_b);
            #1;
            if (out === want)
                $display("PASS %0s", name);
            else begin
                $display("FAIL %0s expected=%b got=%b inputs=a:%b,b:%b",
                         name, want, out, a, b);
                failures = failures + 1;
            end
        end
    endtask

    initial begin
        failures = 0;
        check("truth_00", 1'b0, 1'b0);
        check("truth_01", 1'b0, 1'b1);
        check("truth_11", 1'b1, 1'b1);
        check("truth_10", 1'b1, 1'b0);

        // Exercise every ordered transition, including unchanged inputs
        // and simultaneous changes of both inputs.
        for (i = 0; i < 16; i = i + 1) begin
            check($sformatf("transition_%0d_before", i),
                  (i >> 3) & 1, (i >> 2) & 1);
            check($sformatf("transition_%0d_after", i),
                  (i >> 1) & 1, i & 1);
        end

        for (i = 0; i < 200; i = i + 1)
            check($sformatf("random_%0d", i),
                  $urandom_range(0, 1), $urandom_range(0, 1));

        // Check that a stable input retains its expected output.
        check("stable_setup", 1'b1, 1'b1);
        expected = 1'b1;
        #10;
        if (out === expected)
            $display("PASS stable_hold");
        else begin
            $display("FAIL stable_hold expected=%b got=%b inputs=a:%b,b:%b",
                     expected, out, a, b);
            failures = failures + 1;
        end

        if (failures == 0)
            $display("PASS all_checks");
        else
            $display("FAIL all_checks expected=0 got=%0d inputs=a:%b,b:%b",
                     failures, a, b);
        $finish;
    end
endmodule
