import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe,expect,it,beforeEach,vi} from "vitest";

describe("Computer Use execution boundary",()=>{
  let root:string;
  beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"bob-computer-"));process.env.BOB_STORAGE_DIR=root;vi.resetModules();});
  it("führt eine autorisierte Aktion über einen echten Child-Process-Driver aus und auditiert nur Digests",async()=>{
    const driver=path.join(root,"driver.mjs");
    fs.writeFileSync(driver,'process.stdin.on("data",b=>{const x=JSON.parse(String(b)); process.stdout.write(JSON.stringify({ok:true,action:x.action})); process.exit(0);});');
    fs.chmodSync(driver,0o700);
    process.env.BOB_COMPUTER_DRIVER=driver;
    const computers=await import("../../lib/computer-use");
    const exec=await import("../../lib/computer-driver");
    const c=computers.listComputers()[0];
    computers.authorizeComputer(c.id,true,"CREATOR");
    computers.allocateComputer(c.id,"TASK-CU","SB-CU");
    computers.startComputer(c.id);
    const result=await exec.executeComputerAction({computerId:c.id,action:"SCREENSHOT",input:{url:"http://example.test"}});
    expect(result.status).toBe("SUCCEEDED");
    expect(result.stdoutDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.stdoutLength).toBeGreaterThan(0);
  });
  it("bleibt ohne Driver fail closed",async()=>{
    delete process.env.BOB_COMPUTER_DRIVER;
    const computers=await import("../../lib/computer-use");
    const exec=await import("../../lib/computer-driver");
    const c=computers.listComputers()[0];
    computers.authorizeComputer(c.id,true,"CREATOR");
    computers.allocateComputer(c.id,"TASK-CU-2");
    computers.startComputer(c.id);
    await expect(exec.executeComputerAction({computerId:c.id,action:"NAVIGATE",input:{url:"http://example.test"}})).rejects.toThrow(/driver is not configured/);
  });
  it("führt Computer Use über den zentralen Execution Broker mit Capability-Token aus",async()=>{
    const cp=await import("../../lib/control-plane");
    const fabric=await import("../../lib/sandbox/fabric");
    const authority=await import("../../lib/authority");
    const broker=await import("../../lib/execution-broker");
    const mission=cp.createMission({title:"Computer Broker",objective:"Brokerpfad",createdBy:"CREATOR"});
    const objective=cp.createObjective({missionId:mission.missionId,title:"CU Broker",description:"Brokerpfad"});
    const task=cp.createTask({missionId:mission.missionId,objectiveId:objective.objectiveId,title:"CU Broker Task",risk:"LOW",assignedAgent:"AG-BROWSER",createdBy:"CREATOR"});
    const sandbox=await fabric.createSandbox({type:"browser",taskId:task.taskId,agentId:"AG-BROWSER",risk:"LOW"});
    await fabric.startSandbox(sandbox.sandboxId);
    const token=authority.issueCapabilityToken({
      subject:"AG-BROWSER",taskId:task.taskId,sandboxId:sandbox.sandboxId,environment:"browser",
      capabilities:["task:execute","sandbox:run"],risk:"LOW",issuedBy:"CREATOR",issuedByKind:"CREATOR",
      expiresAt:new Date(Date.now()+600_000).toISOString()
    });
    const computers=await import("../../lib/computer-use");
    const c=computers.listComputers()[0];
    computers.authorizeComputer(c.id,true,"CREATOR");
    computers.allocateComputer(c.id,task.taskId,sandbox.sandboxId);
    computers.startComputer(c.id);
    const result=await broker.executeComputerAuthorized({
      taskId:task.taskId,agentId:"AG-BROWSER",sandboxId:sandbox.sandboxId,
      capabilityTokenId:token.token.id,environment:"browser",argv:["COMPUTER_USE"],
      computerId:c.id,computerAction:"SCREENSHOT",computerInput:{url:"http://example.test"}
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(authority.capabilityTokens().find(x=>x.id===token.token.id)?.uses).toBe(1);
  });
});
