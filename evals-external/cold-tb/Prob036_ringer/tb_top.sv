`timescale 1ns/1ps

module tb_top;
    reg ring;
    reg vibrate_mode;
    wire ringer;
    wire motor;
    integer seed;
    integer i;
    integer checks;
    integer failures;

    TopModule dut (
        .ring(ring),
        .vibrate_mode(vibrate_mode),
        .ringer(ringer),
        .motor(motor)
    );

    // This interface is combinational: there is no clock or reset port.
    // Separate input changes and observations to allow logic to settle.
    task automatic check_case;
        input string name;
        input reg call_active;
        input reg vibration_selected;
        reg [1:0] expected;
        begin
            #5;
            ring = call_active;
            vibrate_mode = vibration_selected;
            // Bit order is {ringer, motor}. An idle phone enables neither.
            if (!call_active)
                expected = 2'b00;
            else if (vibration_selected)
                expected = 2'b01;
            else
                expected = 2'b10;
            #1;
            checks = checks + 1;
            if ({ringer, motor} === expected)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%b got=%b inputs=ring:%b,vibrate_mode:%b",
                         name, expected, {ringer, motor}, ring, vibrate_mode);
            end
        end
    endtask

    initial begin
        ring = 1'b0;
        vibrate_mode = 1'b0;
        checks = 0;
        failures = 0;
        seed = 32'h317a92b5;

        // Exhaustive truth table.
        check_case("idle_normal",    1'b0, 1'b0);
        check_case("idle_vibrate",   1'b0, 1'b1);
        check_case("incoming_normal", 1'b1, 1'b0);
        check_case("incoming_vibrate", 1'b1, 1'b1);

        // Mode changes during a call, call removal, and repeated inputs.
        check_case("active_switch_to_normal", 1'b1, 1'b0);
        check_case("active_switch_to_vibrate", 1'b1, 1'b1);
        check_case("active_vibrate_hold", 1'b1, 1'b1);
        check_case("end_vibrating_call", 1'b0, 1'b1);
        check_case("idle_switch_to_normal", 1'b0, 1'b0);
        check_case("start_ringing_call", 1'b1, 1'b0);
        check_case("end_ringing_call", 1'b0, 1'b0);
        check_case("idle_hold", 1'b0, 1'b0);
        check_case("both_inputs_rise", 1'b1, 1'b1);
        check_case("both_inputs_fall", 1'b0, 1'b0);

        // Seeded random sequences exercise arbitrary ordering and repetition.
        for (i = 0; i < 256; i = i + 1)
            check_case($sformatf("random_%0d", i),
                       $random(seed), $random(seed));

        $display("SUMMARY checks=%0d failures=%0d", checks, failures);
        $finish;
    end
endmodule
