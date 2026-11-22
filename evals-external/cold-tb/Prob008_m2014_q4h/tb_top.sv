`timescale 1ns/1ps

module tb_top;
    reg in;
    wire out;
    integer i;
    integer failures;

    TopModule dut (
        .in(in),
        .out(out)
    );

    // The specification requires a combinational, four-state wire copy.
    // There is no clock or reset port in this interface.
    task automatic check_value(input reg value, input string name);
        begin
            in = value;
            #1;
            if (out === value) begin
                $display("PASS %s", name);
            end else begin
                $display("FAIL %s expected=%b got=%b inputs=in:%b",
                         name, value, out, in);
                failures = failures + 1;
            end
        end
    endtask

    initial begin
        failures = 0;
        check_value(1'b0, "initial_zero");
        check_value(1'b0, "hold_zero");
        check_value(1'b1, "rise_to_one");
        check_value(1'b1, "hold_one");
        check_value(1'b0, "fall_to_zero");
        check_value(1'bx, "propagate_unknown");
        check_value(1'b1, "recover_from_unknown");
        check_value(1'bz, "propagate_high_impedance");
        check_value(1'b0, "recover_from_high_impedance");

        for (i = 0; i < 256; i = i + 1)
            check_value($urandom_range(0, 1), $sformatf("random_%0d", i));

        if (failures == 0)
            $display("PASS all_checks");
        else
            $display("FAIL all_checks expected=0 got=%0d inputs=in:%b",
                     failures, in);
        $finish;
    end
endmodule
