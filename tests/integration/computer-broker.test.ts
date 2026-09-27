import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {beforeEach,describe,expect,it} from "vitest";

describe("Computer Use canonical execution broker",()=>{
  let root:string;
  beforeEach(()=>{
    root=fs.mkdtempSync(path.join(os.tmpdir(),"bob-computer-broker-"));
    process.env.BOB_STORAGE_DIR=root;
    process.env.BOB_COMPUTER_DRIVER=path.join(root,"driver.mjs");
  });

  it("führt eine autorisierte Computer-Aktion erst nach dem Execution-Broker aus",async()=>{
    fs.writeFileSync(process.env.BOB_COMPUTER_DRIVER!,
      '#!/usr/bin/env node\nprocess.stdin.on("data",b=>{const x=JSON.parse(String(b)); process.stdout.write(JSON.stringify({ok:true,action:x.action})); process.exit(0);});'
    );
    fs.chmodSync(process.env.BOB_COMPUTER_DRIVER!,0o700);

    const harness=await import("../../lib/fault-harness");
    const computers=await import("../../lib/computer-use");
    const broker=await import("../../lib/execution-broker");

    const context=await harness.buildSandboxContext("computer-broker");
    const computer=computers.listComputers()[0];
    computers.authorizeComputer(computer.id,true,"CREATOR");
    computers.allocateComputer(computer.id,context.taskId,context.sandboxId);
    computers.startComputer(computer.id);

    const result=await broker.executeComputerAuthorized({
      taskId:context.taskId,
      agentId:context.agentId,
      sandboxId:context.sandboxId,
      capabilityTokenId:context.tokenId,
      runId:context.runId,
      environment:"test",
      argv:["COMPUTER_USE"],
      computerId:computer.id,
      computerAction:"SCREENSHOT",
      computerInput:{url:"http://example.test"}
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.stdoutLength).toBeGreaterThan(0);
    expect(result.stdoutDigest).toMatch(/^[a-f0-9]{64}$/);
  });
});
