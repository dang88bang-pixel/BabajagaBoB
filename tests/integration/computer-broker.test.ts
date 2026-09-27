import fs from "node:fs";
import path from "node:path";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

describe("Computer Use central Execution Broker path", () => {
  beforeEach(() => {
    isolatedStorageRoot("computer-broker");
    vi.resetModules();
  });
  it("führt Computer Use nur über den zentralen Broker mit computer:use + computer:execute aus", async () => {
    const bootstrap = await import("../../lib/bootstrap"), cp = await import("../../lib/control-plane"), fabric = await import("../../lib/sandbox/fabric");
    const authority = await import("../../lib/authority"), computers = await import("../../lib/computer-use"), broker = await import("../../lib/execution-broker");
    bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Computer Broker Test"});
    const mission = cp.createMission({title: "Computer Broker", objective: "Zentralen Pfad nachweisen", createdBy: "CREATOR"});
    const task = cp.createTask({missionId: mission.missionId, title: "Browser Aktion", risk: "LOW", assignedAgent: "AG-BROWSER", createdBy: "CREATOR"});
    cp.updateTaskStatus(task.taskId, "RUNNING", 10);
    const sandbox = await fabric.createSandbox({type: "browser", taskId: task.taskId, agentId: "AG-BROWSER", risk: "LOW"});
    await fabric.startSandbox(sandbox.sandboxId);
    const issued = authority.issueCapabilityToken({subject:"AG-BROWSER",taskId:task.taskId,sandboxId:sandbox.sandboxId,environment:"browser",capabilities:["computer:execute","sandbox:run"],risk:"LOW",issuedBy:"CREATOR",issuedByKind:"CREATOR",expiresAt:new Date(Date.now()+300000).toISOString()});
    const driver = path.join(process.env.BOB_STORAGE_DIR!, "driver.mjs");
    fs.writeFileSync(driver, 'process.stdin.on("data",b=>{const x=JSON.parse(String(b));process.stdout.write(JSON.stringify({ok:true,action:x.action}));process.exit(0);});');
    fs.chmodSync(driver, 0o700); process.env.BOB_COMPUTER_DRIVER=driver;
    const computer=computers.listComputers()[0]; computers.authorizeComputer(computer.id,true,"CREATOR"); computers.allocateComputer(computer.id,task.taskId,sandbox.sandboxId); computers.startComputer(computer.id);
    const result=await broker.executeComputerAuthorized({taskId:task.taskId,agentId:"AG-BROWSER",sandboxId:sandbox.sandboxId,capabilityTokenId:issued.token.id,environment:"browser",argv:[],computerId:computer.id,computerAction:"SCREENSHOT",computerInput:{}});
    expect(result.status).toBe("SUCCEEDED"); expect(result.stdoutLength).toBeGreaterThan(0); expect(authority.getCapabilityToken(issued.token.id)?.uses).toBe(1);
  });
  it("verweigert den Computer-Pfad ohne computer:use, auch wenn ein Token vorhanden ist", async () => {
    const bootstrap = await import("../../lib/bootstrap"), cp = await import("../../lib/control-plane"), fabric = await import("../../lib/sandbox/fabric");
    const authority = await import("../../lib/authority"), computers = await import("../../lib/computer-use"), broker = await import("../../lib/execution-broker");
    bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Computer Broker Denial"});
    const mission=cp.createMission({title:"Computer Denial",objective:"Capability-Grenze",createdBy:"CREATOR"});
    const task=cp.createTask({missionId:mission.missionId,title:"Denied browser",risk:"LOW",assignedAgent:"AG-BUILD",createdBy:"CREATOR"});
    const sandbox=await fabric.createSandbox({type:"browser",taskId:task.taskId,agentId:"AG-BUILD",risk:"LOW"}); await fabric.startSandbox(sandbox.sandboxId);
    const issued=authority.issueCapabilityToken({subject:"AG-BUILD",taskId:task.taskId,sandboxId:sandbox.sandboxId,environment:"browser",capabilities:["computer:execute","sandbox:run"],risk:"LOW",issuedBy:"CREATOR",issuedByKind:"CREATOR",expiresAt:new Date(Date.now()+300000).toISOString()});
    const computer=computers.listComputers()[0]; computers.authorizeComputer(computer.id,true,"CREATOR"); computers.allocateComputer(computer.id,task.taskId,sandbox.sandboxId); computers.startComputer(computer.id);
    await expect(broker.executeComputerAuthorized({taskId:task.taskId,agentId:"AG-BUILD",sandboxId:sandbox.sandboxId,capabilityTokenId:issued.token.id,environment:"browser",argv:[],computerId:computer.id,computerAction:"SCREENSHOT",computerInput:{}})).rejects.toThrow(/computer:use/);
  });
});