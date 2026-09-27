import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {beforeEach,describe,expect,it,vi} from "vitest";

describe("Computer Use through Execution Broker",()=>{
  let root:string;
  beforeEach(()=>{
    root=fs.mkdtempSync(path.join(os.tmpdir(),"bob-computer-broker-"));
    process.env.BOB_STORAGE_DIR=root;
    vi.resetModules();
  });

  it("issues a scoped computer capability and executes only through the broker",async()=>{
    const driver=path.join(root,"driver.mjs");
    fs.writeFileSync(driver,'process.stdin.on("data",b=>{const x=JSON.parse(String(b)); process.stdout.write(JSON.stringify({ok:true,action:x.action})); process.exit(0);});');
    fs.chmodSync(driver,0o700);
    process.env.BOB_COMPUTER_DRIVER=driver;

    const computers=await import("../../lib/computer-use");
    const authority=await import("../../lib/authority");
    const broker=await import("../../lib/execution-broker");

    const computer=computers.listComputers()[0];
    computers.authorizeComputer(computer.id,true,"CREATOR");
    computers.allocateComputer(computer.id,"TASK-001","SB-001");
    computers.startComputer(computer.id);

    const capability=authority.ensureExecutionCapability(
      "AG-BUILD","TASK-001","SB-001","LOW","development",
      ["task:execute","sandbox:run","computer:execute"]
    );

    const result=await broker.executeComputerAuthorized({
      taskId:"TASK-001",
      agentId:"AG-BUILD",
      sandboxId:"SB-001",
      capabilityTokenId:capability.id,
      runId:"RUN-CU-BROKER",
      environment:"development",
      argv:["COMPUTER_USE"],
      computerId:computer.id,
      computerAction:"SCREENSHOT",
      computerInput:{target:"test"}
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(authority.getCapabilityToken(capability.id)?.uses).toBe(1);
  });

  it("rejects a computer allocated to another task before consuming the capability",async()=>{
    const computers=await import("../../lib/computer-use");
    const authority=await import("../../lib/authority");
    const broker=await import("../../lib/execution-broker");

    const computer=computers.listComputers()[0];
    computers.authorizeComputer(computer.id,true,"CREATOR");
    computers.allocateComputer(computer.id,"OTHER-TASK","SB-OTHER");
    computers.startComputer(computer.id);

    const capability=authority.ensureExecutionCapability(
      "AG-BUILD","TASK-001","SB-001","LOW","development",
      ["task:execute","sandbox:run","computer:execute"]
    );

    await expect(broker.executeComputerAuthorized({
      taskId:"TASK-001",
      agentId:"AG-BUILD",
      sandboxId:"SB-001",
      capabilityTokenId:capability.id,
      argv:["COMPUTER_USE"],
      computerId:computer.id,
      computerAction:"SCREENSHOT",
      computerInput:{}
    })).rejects.toThrow(/different task/);

    expect(authority.getCapabilityToken(capability.id)?.uses).toBe(0);
  });
});
