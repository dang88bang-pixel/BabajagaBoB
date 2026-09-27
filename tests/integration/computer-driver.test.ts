import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe,expect,it,beforeEach,vi} from "vitest";
import * as cp from "../../lib/control-plane";
import * as fabric from "../../lib/sandbox";
import * as authority from "../../lib/authority";
import {TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

describe("Computer Use execution boundary",()=>{
  let root:string;
  beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"bob-computer-"));process.env.BOB_STORAGE_DIR=root;process.env.BOB_BOOTSTRAP_SECRET=TEST_BOOTSTRAP_SECRET;vi.resetModules();});

  it("führt eine autorisierte Aktion über Execution Gate, Broker und echten Child-Process-Driver aus",async()=>{
    const driver=path.join(root,"driver.mjs");
    fs.writeFileSync(driver,'#!/usr/bin/env node\nprocess.stdin.on("data",b=>{const x=JSON.parse(String(b)); process.stdout.write(JSON.stringify({ok:true,action:x.action})); process.exit(0);});');
    fs.chmodSync(driver,0o700);
    process.env.BOB_COMPUTER_DRIVER=driver;

    const bootstrap=await import("../../lib/bootstrap");
    const cp=await import("../../lib/control-plane");
    const fabric=await import("../../lib/sandbox/fabric");
    const authority=await import("../../lib/authority");
    const computers=await import("../../lib/computer-use");
    const broker=await import("../../lib/execution-broker");

    bootstrap.completeBootstrap({secret:TEST_BOOTSTRAP_SECRET,creatorName:"Computer Broker Test"});
    const mission=cp.createMission({title:"Computer Broker",objective:"Brokerpfad",createdBy:"CREATOR"});
    const objective=cp.createObjective({missionId:mission.missionId,title:"Computer Objective",description:"Brokerpfad"});
    const task=cp.createTask({missionId:mission.missionId,objectiveId:objective.objectiveId,title:"Computer Task",risk:"LOW",assignedAgent:"AG-BUILD",createdBy:"CREATOR"});
    const sandbox=await fabric.createSandbox({type:"browser",taskId:task.taskId,agentId:"AG-BUILD",risk:"LOW"});
    await fabric.startSandbox(sandbox.sandboxId);

    const computer=computers.listComputers()[0];
    computers.authorizeComputer(computer.id,true,"CREATOR");
    computers.allocateComputer(computer.id,task.taskId,sandbox.sandboxId);
    computers.startComputer(computer.id);

    const issued=authority.issueCapabilityToken({
      subject:"AG-BUILD",
      taskId:task.taskId,
      sandboxId:sandbox.sandboxId,
      environment:"browser",
      capabilities:["task:execute","sandbox:run","computer:execute"],
      risk:"LOW",
      issuedBy:"CREATOR",
      issuedByKind:"CREATOR",
      expiresAt:new Date(Date.now()+600_000).toISOString()
    });

    const result=await broker.executeComputerAuthorized({
      taskId:task.taskId,
      agentId:"AG-BUILD",
      sandboxId:sandbox.sandboxId,
      capabilityTokenId:issued.token.id,
      environment:"browser",
      argv:["COMPUTER_USE"],
      computerId:computer.id,
      computerAction:"SCREENSHOT",
      computerInput:{url:"http://example.test"}
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.stdoutDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.stdoutLength).toBeGreaterThan(0);
  });

  it("führt Computer Use nur über den zentralen Execution Broker aus",async()=>{
    const task = cp.createTask({missionId:cp.createMission({title:"CU Broker",objective:"Brokerpfad",createdBy:"CREATOR"}).missionId,title:"CU Broker Task",risk:"LOW",assignedAgent:"AG-BROWSER",createdBy:"CREATOR"});
    const sandbox = await fabric.createSandbox({type:"browser",taskId:task.taskId,agentId:"AG-BROWSER",risk:"LOW"});
    await fabric.startSandbox(sandbox.sandboxId);
    const computer = computers.listComputers()[0];
    computers.authorizeComputer(computer.id,true,"CREATOR");
    computers.allocateComputer(computer.id,task.taskId,sandbox.sandboxId);
    computers.startComputer(computer.id);
    const issued = authority.issueCapabilityToken({subject:"AG-BROWSER",taskId:task.taskId,sandboxId:sandbox.sandboxId,environment:sandbox.type,capabilities:["task:execute","sandbox:run","computer:execute"],risk:"LOW",issuedBy:"CREATOR",issuedByKind:"CREATOR",expiresAt:new Date(Date.now()+60_000).toISOString()});
    const broker = await import("../../lib/execution-broker");
    const result = await broker.executeComputerAuthorized({taskId:task.taskId,agentId:"AG-BROWSER",sandboxId:sandbox.sandboxId,capabilityTokenId:issued.token.id,runId:"RUN-CU-BROKER",computerId:computer.id,computerAction:"SCREENSHOT",computerInput:{url:"http://example.test"}});
    expect(result.status).toBe("SUCCEEDED");
    expect(authority.getCapabilityToken(issued.token.id)?.uses).toBe(1);
  });

  it("verweigert den Brokerpfad mit falschem Task/Token-Binding",async()=>{
    const task = cp.createTask({missionId:cp.createMission({title:"CU Scope",objective:"Scope",createdBy:"CREATOR"}).missionId,title:"CU Scope Task",risk:"LOW",assignedAgent:"AG-BROWSER",createdBy:"CREATOR"});
    const otherTask = cp.createTask({missionId:task.missionId,title:"Andere Task",risk:"LOW",assignedAgent:"AG-BROWSER",createdBy:"CREATOR"});
    const sandbox = await fabric.createSandbox({type:"browser",taskId:task.taskId,agentId:"AG-BROWSER",risk:"LOW"});
    await fabric.startSandbox(sandbox.sandboxId);
    const computer = computers.listComputers()[0];
    computers.authorizeComputer(computer.id,true,"CREATOR");
    computers.allocateComputer(computer.id,task.taskId,sandbox.sandboxId);
    computers.startComputer(computer.id);
    const issued = authority.issueCapabilityToken({subject:"AG-BROWSER",taskId:otherTask.taskId,sandboxId:sandbox.sandboxId,environment:sandbox.type,capabilities:["task:execute","sandbox:run","computer:execute"],risk:"LOW",issuedBy:"CREATOR",issuedByKind:"CREATOR",expiresAt:new Date(Date.now()+60_000).toISOString()});
    const broker = await import("../../lib/execution-broker");
    await expect(broker.executeComputerAuthorized({taskId:task.taskId,agentId:"AG-BROWSER",sandboxId:sandbox.sandboxId,capabilityTokenId:issued.token.id,computerId:computer.id,computerAction:"SCREENSHOT",computerInput:{}})).rejects.toThrow(/scope mismatch|token task/);
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
});
