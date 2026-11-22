`timescale 1ns/1ps

module tb_top;
    reg clk = 1'b0;
    reg resetn = 1'b1;
    reg [2:0] r = 3'b000;
    wire [2:0] g;

    TopModule dut (.clk(clk), .resetn(resetn), .r(r), .g(g));

    always #5 clk = ~clk;

    reg [2:0] expected;
    reg initialized = 1'b0;
    integer checks = 0;
    integer failures = 0;
    integer owner, requests, i;
    reg [2:0] owner_request;

    // Model only externally specified grants, independent of DUT state codes.
    // The prose resolves the duplicated A->D condition in the diagram:
    // device 2 wins in A only for r=100, and holds until r[2] drops.
    function automatic [2:0] next_grant;
        input [2:0] previous;
        input [2:0] request;
        input rst_n;
        begin
            if (!rst_n)
                next_grant = 3'b000;
            else begin
                case (previous)
                    3'b000: begin
                        if (request[0]) next_grant = 3'b001;
                        else if (request[1]) next_grant = 3'b010;
                        else if (request[2]) next_grant = 3'b100;
                        else next_grant = 3'b000;
                    end
                    3'b001: next_grant = request[0] ? 3'b001 : 3'b000;
                    3'b010: next_grant = request[1] ? 3'b010 : 3'b000;
                    3'b100: next_grant = request[2] ? 3'b100 : 3'b000;
                    default: next_grant = 3'bxxx;
                endcase
            end
        end
    endfunction

    task automatic check_grant;
        input string name;
        input [2:0] want;
        begin
            checks = checks + 1;
            if (g === want)
                $display("PASS %s", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s expected=%03b got=%03b inputs=resetn:%b,r:%03b,clk:%b",
                         name, want, g, resetn, r, clk);
            end
        end
    endtask

    task automatic step;
        input reg rst_n;
        input reg [2:0] request;
        input string name;
        begin
            // Inputs change half a clock period away from the active edge.
            @(negedge clk);
            resetn = rst_n;
            r = request;
            #1;
            if (initialized)
                check_grant($sformatf("%s_before_edge", name), expected);
            @(posedge clk);
            expected = next_grant(expected, request, rst_n);
            initialized = 1'b1;
            #1; // Let nonblocking state updates and output logic settle.
            check_grant($sformatf("%s_after_edge", name), expected);
        end
    endtask

    initial begin
        step(1'b0, 3'b111, "initial_synchronous_reset");
        step(1'b0, 3'b000, "reset_held");
        step(1'b1, 3'b000, "idle_after_reset");

        // Exhaust every request vector from idle and from each granted state.
        // Re-establish the source state for every independent transition.
        for (owner = 0; owner < 4; owner = owner + 1) begin
            for (requests = 0; requests < 8; requests = requests + 1) begin
                step(1'b0, 3'b111,
                     $sformatf("matrix_reset_state%0d_req%0d", owner, requests));
                if (owner != 0) begin
                    owner_request = 3'b001 << (owner - 1);
                    step(1'b1, owner_request,
                         $sformatf("matrix_acquire_state%0d_req%0d", owner, requests));
                end
                step(1'b1, requests[2:0],
                     $sformatf("matrix_transition_state%0d_req%0d", owner, requests));
            end
        end

        // Holding a grant prevents preemption, even by a higher priority device.
        // Release must spend one cycle in A before awarding another grant.
        for (owner = 0; owner < 3; owner = owner + 1) begin
            owner_request = 3'b001 << owner;
            step(1'b0, 3'b000, $sformatf("owner%0d_reset", owner));
            step(1'b1, owner_request, $sformatf("owner%0d_acquire", owner));
            for (i = 0; i < 5; i = i + 1)
                step(1'b1, 3'b111, $sformatf("owner%0d_hold%0d", owner, i));
            step(1'b1, ~owner_request, $sformatf("owner%0d_release_to_idle", owner));
            step(1'b1, ~owner_request, $sformatf("owner%0d_rearbitrate", owner));

            // Reset assertion cannot remove a live grant until a rising edge.
            step(1'b0, 3'b111, $sformatf("owner%0d_reset_live_grant", owner));
            step(1'b1, owner_request, $sformatf("owner%0d_reacquire", owner));

            // A reset pulse wholly between rising edges must have no effect.
            @(negedge clk);
            resetn = 1'b0;
            #1;
            check_grant($sformatf("owner%0d_short_reset_assert", owner), expected);
            #1;
            resetn = 1'b1;
            #1;
            check_grant($sformatf("owner%0d_short_reset_release", owner), expected);
            @(posedge clk);
            expected = next_grant(expected, r, resetn);
            #1;
            check_grant($sformatf("owner%0d_short_reset_next_edge", owner), expected);
        end

        // All request bits vary independently, with occasional synchronous resets.
        for (i = 0; i < 512; i = i + 1)
            step(($urandom_range(0, 15) != 0), $urandom_range(0, 7),
                 $sformatf("random_%0d", i));

        step(1'b0, 3'b111, "final_reset");
        for (i = 0; i < 8; i = i + 1)
            step(1'b1, 3'b000, $sformatf("final_idle_%0d", i));

        if (failures == 0)
            $display("PASS summary checks=%0d", checks);
        else
            $display("FAIL summary expected=0 got=%0d inputs=resetn:%b,r:%03b,clk:%b checks=%0d",
                     failures, resetn, r, clk, checks);
        $finish;
    end
endmodule
