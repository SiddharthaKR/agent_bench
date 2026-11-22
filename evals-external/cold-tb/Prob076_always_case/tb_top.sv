`timescale 1ns/1ps

module tb_top;
    reg [2:0] sel;
    reg [3:0] data0, data1, data2, data3, data4, data5;
    wire [3:0] out;
    integer s, lane, value, trial;
    integer checks = 0;
    integer failures = 0;

    TopModule dut (
        .sel(sel),
        .data0(data0),
        .data1(data1),
        .data2(data2),
        .data3(data3),
        .data4(data4),
        .data5(data5),
        .out(out)
    );

    task check_output(input string name);
        reg [3:0] expected;
        begin
            // Allow the combinational circuit to settle after input changes.
            #1;
            case (sel)
                3'd0: expected = data0;
                3'd1: expected = data1;
                3'd2: expected = data2;
                3'd3: expected = data3;
                3'd4: expected = data4;
                3'd5: expected = data5;
                default: expected = 4'd0;
            endcase
            checks = checks + 1;
            if (out === expected)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%h got=%h inputs=sel:%d,data0:%h,data1:%h,data2:%h,data3:%h,data4:%h,data5:%h",
                         name, expected, out, sel,
                         data0, data1, data2, data3, data4, data5);
            end
        end
    endtask

    initial begin
        // This is a purely combinational interface: no clock or reset exists.
        sel = 0;
        data0 = 0; data1 = 0; data2 = 0;
        data3 = 0; data4 = 0; data5 = 0;
        check_output("initial_zero");

        // Distinct values expose swapped inputs and selector decoding errors.
        data0 = 4'h1; data1 = 4'h2; data2 = 4'h4;
        data3 = 4'h8; data4 = 4'ha; data5 = 4'hf;
        for (s = 0; s < 8; s = s + 1) begin
            sel = s;
            check_output($sformatf("distinct_sel_%0d", s));
        end

        // Exercise every value of every input with every selector. Other
        // inputs remain zero, then all ones, to detect unwanted coupling.
        for (trial = 0; trial < 2; trial = trial + 1)
            for (lane = 0; lane < 6; lane = lane + 1)
                for (value = 0; value < 16; value = value + 1) begin
                    data0 = trial ? 4'hf : 4'h0;
                    data1 = trial ? 4'hf : 4'h0;
                    data2 = trial ? 4'hf : 4'h0;
                    data3 = trial ? 4'hf : 4'h0;
                    data4 = trial ? 4'hf : 4'h0;
                    data5 = trial ? 4'hf : 4'h0;
                    case (lane)
                        0: data0 = value;
                        1: data1 = value;
                        2: data2 = value;
                        3: data3 = value;
                        4: data4 = value;
                        5: data5 = value;
                    endcase
                    for (s = 0; s < 8; s = s + 1) begin
                        sel = s;
                        check_output($sformatf("sweep_bg_%0d_lane_%0d_value_%0d_sel_%0d",
                                               trial, lane, value, s));
                    end
                end

        // Randomize all data together, checking every selector for each set.
        for (trial = 0; trial < 256; trial = trial + 1) begin
            data0 = $urandom;
            data1 = $urandom;
            data2 = $urandom;
            data3 = $urandom;
            data4 = $urandom;
            data5 = $urandom;
            for (s = 0; s < 8; s = s + 1) begin
                sel = s;
                check_output($sformatf("random_%0d_sel_%0d", trial, s));
            end
        end

        // Arbitrary selector transitions also exercise recovery from 6 and 7.
        for (trial = 0; trial < 1024; trial = trial + 1) begin
            sel = $urandom;
            data0 = $urandom;
            data1 = $urandom;
            data2 = $urandom;
            data3 = $urandom;
            data4 = $urandom;
            data5 = $urandom;
            check_output($sformatf("random_transition_%0d", trial));
        end

        $display("SUMMARY checks=%0d failures=%0d", checks, failures);
        $finish;
    end
endmodule
