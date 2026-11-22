`timescale 1ns/1ps

module tb_top;
    reg mode;
    reg too_cold;
    reg too_hot;
    reg fan_on;
    wire heater;
    wire aircon;
    wire fan;

    integer i;
    integer j;
    integer checks = 0;
    integer failures = 0;
    reg [3:0] stimulus;

    TopModule dut (
        .mode(mode),
        .too_cold(too_cold),
        .too_hot(too_hot),
        .fan_on(fan_on),
        .heater(heater),
        .aircon(aircon),
        .fan(fan)
    );

    // The specification describes purely combinational logic, with no
    // clock or reset ports. Each input change receives a settling delay.
    task automatic apply_and_check(input [3:0] value, input string name);
        reg expected_heater;
        reg expected_aircon;
        reg expected_fan;
        reg [2:0] expected;
        begin
            {mode, too_cold, too_hot, fan_on} = value;
            expected_heater = (value[3] == 1'b1) && value[2];
            expected_aircon = (value[3] == 1'b0) && value[1];
            expected_fan = expected_heater || expected_aircon || value[0];
            expected = {expected_heater, expected_aircon, expected_fan};
            #5;
            checks = checks + 1;
            if ({heater, aircon, fan} === expected) begin
                $display("PASS %s", name);
            end else begin
                failures = failures + 1;
                $display("FAIL %s expected=%03b got=%03b inputs=mode:%b,too_cold:%b,too_hot:%b,fan_on:%b",
                         name, expected, {heater, aircon, fan},
                         mode, too_cold, too_hot, fan_on);
            end
        end
    endtask

    initial begin
        // Exhaust all input combinations, including contradictory temperature
        // requests, inactive-mode requests, and forced fan operation.
        for (i = 0; i < 16; i = i + 1)
            apply_and_check(i[3:0], $sformatf("exhaustive_%0d", i));

        // Exercise every ordered pair to detect stale outputs or unintended
        // memory, including mode changes while both temperature flags are high.
        for (i = 0; i < 16; i = i + 1) begin
            for (j = 0; j < 16; j = j + 1) begin
                apply_and_check(i[3:0], $sformatf("transition_%0d_to_%0d_source", i, j));
                apply_and_check(j[3:0], $sformatf("transition_%0d_to_%0d_target", i, j));
            end
        end

        for (i = 0; i < 512; i = i + 1) begin
            stimulus = $urandom;
            apply_and_check(stimulus, $sformatf("random_%0d", i));
        end

        if (failures == 0)
            $display("PASS summary checks=%0d", checks);
        else
            $display("FAIL summary expected=0 got=%0d inputs=all_tested_vectors checks=%0d",
                     failures, checks);
        $finish;
    end
endmodule
