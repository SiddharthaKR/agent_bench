`timescale 1ns/1ps

module tb_top;
    reg clk;
    reg enable;
    reg S;
    reg A, B, C;
    wire Z;

    TopModule dut (
        .clk(clk),
        .enable(enable),
        .S(S),
        .A(A),
        .B(B),
        .C(C),
        .Z(Z)
    );

    reg [7:0] expected_q;
    reg [31:0] rng;
    integer checks, failures;
    integer i, j, pattern;
    reg [7:0] data_byte;

    initial clk = 1'b0;
    always #5 clk = ~clk;

    // The specification has no reset or guaranteed power-up contents.
    // Only begin checking after eight enabled shifts initialize every bit.
    task automatic check_z(input string name);
        reg want;
        begin
            want = expected_q[{A, B, C}];
            checks = checks + 1;
            if (Z === want)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%b got=%b inputs=clk:%b,enable:%b,S:%b,A:%b,B:%b,C:%b,reference_Q:%08b",
                         name, want, Z, clk, enable, S, A, B, C,
                         expected_q);
            end
        end
    endtask

    // Drive on the falling edge, check before the rising edge, then
    // update the independent reference state and allow NBA propagation.
    task automatic cycle(input reg en, input reg serial_bit,
                         input reg [2:0] address, input string name);
        begin
            @(negedge clk);
            enable = en;
            S = serial_bit;
            {A, B, C} = address;
            #1;
            check_z($sformatf("%s_before_rising_edge", name));
            @(posedge clk);
            if (en)
                expected_q = {expected_q[6:0], serial_bit};
            #1;
            check_z($sformatf("%s_after_rising_edge", name));
        end
    endtask

    // Sweep reads while holding storage. S changes while disabled, and
    // addresses change in both clock phases to exercise asynchronous reads.
    task automatic scan(input string name);
        integer address;
        begin
            for (address = 0; address < 8; address = address + 1) begin
                @(negedge clk);
                enable = 1'b0;
                S = address[0];
                {A, B, C} = address[2:0];
                #1;
                check_z($sformatf("%s_low_address_%0d", name, address));
                @(posedge clk);
                #1;
                {A, B, C} = 3'd7 - address[2:0];
                S = ~S;
                #1;
                check_z($sformatf("%s_high_address_%0d", name, 7-address));
            end
        end
    endtask

    initial begin
        checks = 0;
        failures = 0;
        expected_q = 8'bxxxxxxxx;
        enable = 1'b0;
        S = 1'b0;
        {A, B, C} = 3'b000;
        rng = 32'h6a09e667;

        for (i = 0; i < 8; i = i + 1) begin
            @(negedge clk);
            enable = 1'b1;
            S = 1'b0;
            @(posedge clk);
            expected_q = {expected_q[6:0], 1'b0};
            #1;
        end
        check_z("initialized_by_eight_zero_shifts");
        scan("initial_zero_contents");

        // A walking one traverses all eight stages and then shifts out.
        cycle(1'b1, 1'b1, 3'd0, "walking_one_insert");
        scan("walking_one_stage_0");
        for (i = 1; i <= 8; i = i + 1) begin
            cycle(1'b1, 1'b0, i[2:0],
                  $sformatf("walking_one_shift_%0d", i));
            scan($sformatf("walking_one_stage_%0d", i));
        end

        // Exhaust every possible stored byte. MSB enters first; after
        // eight shifts bit n of the byte must be read at address n.
        for (pattern = 0; pattern < 256; pattern = pattern + 1) begin
            data_byte = pattern[7:0];
            for (j = 7; j >= 0; j = j - 1)
                cycle(1'b1, data_byte[j], j[2:0],
                      $sformatf("load_%02h_bit_%0d", data_byte, j));
            scan($sformatf("all_contents_%02h", data_byte));
        end

        // Reproducible pseudo-random input, enable, and address sequences.
        // Read all addresses after each cycle, also testing long holds.
        for (i = 0; i < 512; i = i + 1) begin
            rng = rng ^ (rng << 13);
            rng = rng ^ (rng >> 17);
            rng = rng ^ (rng << 5);
            cycle(rng[0], rng[8], rng[18:16],
                  $sformatf("random_cycle_%0d", i));
            scan($sformatf("random_read_%0d", i));
        end

        $display("SUMMARY checks=%0d failures=%0d", checks, failures);
        $finish;
    end
endmodule
