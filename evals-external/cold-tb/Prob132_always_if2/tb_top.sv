`timescale 1ns/1ps

module tb_top;
    reg cpu_overheated;
    reg arrived;
    reg gas_tank_empty;
    wire shut_off_computer;
    wire keep_driving;
    integer i, j, k;
    integer failures;
    reg [2:0] stimulus;

    TopModule dut (
        .cpu_overheated(cpu_overheated),
        .shut_off_computer(shut_off_computer),
        .arrived(arrived),
        .gas_tank_empty(gas_tank_empty),
        .keep_driving(keep_driving)
    );

    // The repaired logic must assign both outputs for every input:
    // shut down exactly when overheated; drive only if neither arrived
    // nor out of gas. There is no clock or reset in this interface.
    task automatic check_case(
        input reg hot,
        input reg at_destination,
        input reg empty,
        input string name
    );
        reg expected_shut;
        reg expected_drive;
        begin
            #5;
            cpu_overheated = hot;
            arrived = at_destination;
            gas_tank_empty = empty;
            expected_shut = hot;
            expected_drive = !at_destination && !empty;
            #1;
            if (shut_off_computer !== expected_shut) begin
                $display("FAIL %s_shut expected=%b got=%b inputs=cpu_overheated:%b,arrived:%b,gas_tank_empty:%b",
                         name, expected_shut, shut_off_computer,
                         cpu_overheated, arrived, gas_tank_empty);
                failures = failures + 1;
            end else
                $display("PASS %s_shut", name);

            if (keep_driving !== expected_drive) begin
                $display("FAIL %s_drive expected=%b got=%b inputs=cpu_overheated:%b,arrived:%b,gas_tank_empty:%b",
                         name, expected_drive, keep_driving,
                         cpu_overheated, arrived, gas_tank_empty);
                failures = failures + 1;
            end else
                $display("PASS %s_drive", name);
        end
    endtask

    initial begin
        failures = 0;
        // Start with unknown inputs so the first binary case must settle
        // without relying on any previous output value or initialization.
        cpu_overheated = 1'bx;
        arrived = 1'bx;
        gas_tank_empty = 1'bx;
        check_case(0, 0, 0, "startup_cool_driving");

        // Explicitly exercise deassertion and arrival after driving, the
        // paths that would otherwise preserve stale values in latches.
        check_case(1, 0, 0, "overheat");
        check_case(0, 0, 0, "cooled_down");
        check_case(0, 1, 0, "arrived_after_driving");
        check_case(0, 0, 1, "empty_tank");
        check_case(0, 0, 0, "refueled");
        check_case(1, 1, 1, "all_conditions_asserted");

        // All 64 ordered input transitions, including unchanged inputs.
        for (i = 0; i < 8; i = i + 1) begin
            for (j = 0; j < 8; j = j + 1) begin
                check_case(i[2], i[1], i[0],
                           $sformatf("transition_%0d_%0d_before", i, j));
                check_case(j[2], j[1], j[0],
                           $sformatf("transition_%0d_%0d_after", i, j));
            end
        end

        for (k = 0; k < 256; k = k + 1) begin
            stimulus = $urandom_range(0, 7);
            check_case(stimulus[2], stimulus[1], stimulus[0],
                       $sformatf("random_%0d", k));
        end

        if (failures == 0)
            $display("PASS summary");
        else
            $display("FAIL summary expected=0 got=%0d inputs=all_tested_cases", failures);
        $finish;
    end
endmodule
