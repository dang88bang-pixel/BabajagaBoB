import {describe,expect,it} from "vitest";

describe("CDP browser driver",()=>{
  it("fails closed when no browser executable is configured",async()=>{
    const old=process.env.BOB_BROWSER_EXECUTABLE;
    delete process.env.BOB_BROWSER_EXECUTABLE;
    const {executeBrowserAction}=await import("../../lib/browser-driver");
    await expect(executeBrowserAction("NAVIGATE",{url:"http://example.test"})).rejects.toThrow(/BOB_BROWSER_EXECUTABLE/);
    if(old===undefined) delete process.env.BOB_BROWSER_EXECUTABLE; else process.env.BOB_BROWSER_EXECUTABLE=old;
  });
  it("executes a real headless browser screenshot when CI provides Chromium",async()=>{
    if(!process.env.BOB_BROWSER_EXECUTABLE) return;
    const {executeBrowserAction}=await import("../../lib/browser-driver");
    const result=await executeBrowserAction("SCREENSHOT",{});
    expect(result.ok).toBe(true);
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.bytes).toBeGreaterThan(100);
  });

  it("executes a real browser action through the Computer Use -> Execution Broker path",async()=>{
    if(!process.env.BOB_BROWSER_EXECUTABLE) return;
    const bootstrap=await import("../../lib/bootstrap");
    const {TEST_BOOTSTRAP_SECRET}=await import("../helpers/runtime");
    const cp=await import("../../lib/control-plane");
    const fabric=await import("../../lib/sandbox/fabric");
    const authority=await import("../../lib/authority");
    const computer=await import("../../lib/computer-use");
    const broker=await import("../../lib/execution-broker");
    bootstrap.completeBootstrap({secret:TEST_BOOTSTRAP_SECRET,creatorName:"Browser Broker Test"});
    const mission=cp.createMission({title:"Browser Broker",objective:"Real browser execution",createdBy:"CREATOR"});
    const task=cp.createTask({missionId:mission.missionId,title:"Browser screenshot",risk:"MODERATE",assignedAgent:"AG-BROWSER",createdBy:"CREATOR"});
    const sandbox=await fabric.createSandbox({type:"browser",taskId:task.taskId,agentId:"AG-BROWSER",risk:"MODERATE"});
    await fabric.startSandbox(sandbox.sandboxId);
    const instance=computer.listComputers().find(x=>x.kind==="BROWSER");
    if(!instance) throw new Error("browser computer instance missing");
    if(!instance.authorized) computer.authorizeComputer(instance.id,true,"CREATOR");
    computer.allocateComputer(instance.id,task.taskId,sandbox.sandboxId);
    computer.startComputer(instance.id);
    const token=authority.issueCapabilityToken({subject:"AG-BROWSER",taskId:task.taskId,sandboxId:sandbox.sandboxId,environment:"browser",capabilities:["task:execute","sandbox:run","computer:execute"],risk:"MODERATE",issuedBy:"CREATOR",issuedByKind:"CREATOR",expiresAt:new Date(Date.now()+600000).toISOString()});
    const result=await broker.executeComputerAuthorized({taskId:task.taskId,agentId:"AG-BROWSER",sandboxId:sandbox.sandboxId,capabilityTokenId:token.token.id,environment:"browser",argv:["COMPUTER_USE"],computerId:instance.id,computerAction:"SCREENSHOT",computerInput:{}});
    expect(result.status).toBe("SUCCEEDED");
    expect(result.stdoutDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects unsupported or unsafe navigation input before browser launch",async()=>{
    const old=process.env.BOB_BROWSER_EXECUTABLE;
    process.env.BOB_BROWSER_EXECUTABLE="/usr/bin/chromium";
    const {executeBrowserAction}=await import("../../lib/browser-driver");
    await expect(executeBrowserAction("NAVIGATE",{url:"javascript:alert(1)"})).rejects.toThrow(/http\(s\)/);
    if(old===undefined) delete process.env.BOB_BROWSER_EXECUTABLE; else process.env.BOB_BROWSER_EXECUTABLE=old;
  });
});
