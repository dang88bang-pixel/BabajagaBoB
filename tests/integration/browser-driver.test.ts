import {describe,expect,it} from "vitest";
import {spawn} from "node:child_process";
import {mkdtempSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

describe("CDP browser driver",()=>{
  it("fails closed when the configured browser executable does not exist",async()=>{
    const old=process.env.BOB_BROWSER_EXECUTABLE;
    process.env.BOB_BROWSER_EXECUTABLE="/definitely/missing/bob-browser";
    const {executeBrowserAction}=await import("../../lib/browser-driver");
    await expect(executeBrowserAction("NAVIGATE",{url:"http://example.test"})).rejects.toThrow();
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
    const {TEST_BOOTSTRAP_SECRET,isolatedStorageRoot}=await import("../helpers/runtime");
    const cp=await import("../../lib/control-plane");
    const fabric=await import("../../lib/sandbox/fabric");
    const authority=await import("../../lib/authority");
    const computer=await import("../../lib/computer-use");
    const broker=await import("../../lib/execution-broker");
    isolatedStorageRoot("browser-broker");
    process.env.BOB_BOOTSTRAP_SECRET=TEST_BOOTSTRAP_SECRET;
    bootstrap.completeBootstrap({secret:TEST_BOOTSTRAP_SECRET,creatorName:"Browser Broker Test"});
    const mission=cp.createMission({title:"Browser Broker",objective:"Real browser execution",createdBy:"CREATOR"});
    const task=cp.createTask({missionId:mission.missionId,title:"Browser screenshot",risk:"MODERATE",assignedAgent:"AG-BUILD",createdBy:"CREATOR"});
    const sandbox=await fabric.createSandbox({type:"browser",taskId:task.taskId,agentId:"AG-BUILD",risk:"MODERATE"});
    await fabric.startSandbox(sandbox.sandboxId);
    const instance=computer.listComputers().find(x=>x.kind==="BROWSER");
    if(!instance) throw new Error("browser computer instance missing");
    if(!instance.authorized) computer.authorizeComputer(instance.id,true,"CREATOR");
    computer.allocateComputer(instance.id,task.taskId,sandbox.sandboxId);
    computer.startComputer(instance.id);
    const token=authority.issueCapabilityToken({subject:"AG-BUILD",taskId:task.taskId,sandboxId:sandbox.sandboxId,environment:"browser",capabilities:["task:execute","sandbox:run","computer:execute"],risk:"MODERATE",issuedBy:"CREATOR",issuedByKind:"CREATOR",expiresAt:new Date(Date.now()+600000).toISOString()});
    const result=await broker.executeComputerAuthorized({taskId:task.taskId,agentId:"AG-BUILD",sandboxId:sandbox.sandboxId,capabilityTokenId:token.token.id,environment:"browser",argv:["COMPUTER_USE"],computerId:instance.id,computerAction:"SCREENSHOT",computerInput:{}});
    expect(result.status).toBe("SUCCEEDED");
    expect(result.stdoutDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("loads the real Control Center in Chromium and verifies the rendered page",async()=>{
    if(!process.env.BOB_BROWSER_EXECUTABLE) return;
    const root=mkdtempSync(path.join(os.tmpdir(),"bob-browser-ui-"));
    const probe=net.createServer();
    await new Promise<void>((resolve,reject)=>{probe.once("error",reject);probe.listen(0,"127.0.0.1",()=>resolve());});
    const address=probe.address();
    const port=typeof address==="object" && address ? address.port : 0;
    await new Promise<void>(resolve=>probe.close(()=>resolve()));
    expect(port).toBeGreaterThan(0);
    const child=spawn(process.execPath,["server.mjs"],{env:{...process.env,NODE_ENV:"production",PORT:String(port),BOB_SESSION_SECRET:"browser-e2e-session-secret-0123456789",BOB_STORAGE_DIR:root},stdio:["ignore","pipe","pipe"]});
    let serverOutput="";
    child.stdout?.on("data",chunk=>{serverOutput+=String(chunk);});
    child.stderr?.on("data",chunk=>{serverOutput+=String(chunk);});
    try {
      const deadline=Date.now()+15000;
      let ready=false;
      while(Date.now()<deadline){try{const response=await fetch("http://127.0.0.1:"+port+"/");if(response.ok){ready=true;break;}}catch{ /* server is still starting */ } await new Promise(r=>setTimeout(r,100));}
      expect(ready,`Control-Center server did not become ready on port ${port}: ${serverOutput.slice(-4000)}`).toBe(true);
      const {executeBrowserAction}=await import("../../lib/browser-driver");
      const result=await executeBrowserAction("NAVIGATE",{url:"http://127.0.0.1:"+port+"/"}) as {ok:boolean; title?:string};
      expect(result.ok).toBe(true);
      expect(result.title).toContain("BabajagaBoB");
    } finally {
      if(child.exitCode===null) child.kill("SIGTERM");
      await new Promise(resolve=>{if(child.exitCode!==null)return resolve(undefined);child.once("exit",()=>resolve(undefined));setTimeout(()=>resolve(undefined),3000);});
    }
  });
  it("rejects unsupported or unsafe navigation input before browser launch",async()=>{
    const old=process.env.BOB_BROWSER_EXECUTABLE;
    process.env.BOB_BROWSER_EXECUTABLE="/usr/bin/chromium";
    const {executeBrowserAction}=await import("../../lib/browser-driver");
    await expect(executeBrowserAction("NAVIGATE",{url:"javascript:alert(1)"})).rejects.toThrow(/http\(s\)/);
    if(old===undefined) delete process.env.BOB_BROWSER_EXECUTABLE; else process.env.BOB_BROWSER_EXECUTABLE=old;
  });
});
