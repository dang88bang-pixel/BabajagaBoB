import {describe,expect,it,beforeEach,vi} from "vitest";

describe("Computer Use through Execution Broker",()=>{
  beforeEach(()=>{vi.resetModules();});

  it("issues a Creator-scoped computer capability and executes only through the broker",async()=>{
    const harness=await import("../../lib/fault-harness");
    const computers=await import("../../lib/computer-use");
    const authority=await import("../../lib/authority");
    const broker=await import("../../lib/execution-broker");

    const context=await harness.buildSandboxContext("computer-broker");
    const computer=computers.listComputers()[0];
    computers.authorizeComputer(computer.id,true,"CREATOR");
    computers.allocateComputer(computer.id,context.taskId,context.sandboxId);
    computers.startComputer(computer.id);

    const issued=authority.issueCapabilityToken({
      subject:context.agentId,
      taskId:context.taskId,
      sandboxId:context.sandboxId,
      environment:"test",
      capabilities:["task:execute","sandbox:run","computer:execute"],
      risk:"LOW",
      issuedBy:"CREATOR",
      issuedByKind:"CREATOR",
      expiresAt:new Date(Date.now()+300000).toISOString()
    });

    const result=await broker.executeComputerAuthorized({
      taskId:context.taskId,
      agentId:context.agentId,
      sandboxId:context.sandboxId,
      capabilityTokenId:issued.token.id,
      runId:context.runId,
      environment:"test",
      argv:["COMPUTER_USE"],
      computerId:computer.id,
      computerAction:"SCREENSHOT",
      computerInput:{target:"test"}
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(authority.getCapabilityToken(issued.token.id)?.uses).toBe(1);
    computers.releaseComputer(computer.id);
  });

  it("rejects a computer allocated to another task before consuming the capability",async()=>{
    const harness=await import("../../lib/fault-harness");
    const computers=await import("../../lib/computer-use");
    const authority=await import("../../lib/authority");
    const broker=await import("../../lib/execution-broker");

    const context=await harness.buildSandboxContext("computer-broker-binding");
    const computer=computers.registerComputer({name:"Binding Isolation CLI",kind:"CLI",os:"linux",arch:"x64",network:"DENY",capabilities:[{kind:"CLI",actions:["SCREENSHOT"],environments:["test"],network:"DENY",risk:"LOW"}],authorized:false});
    computers.authorizeComputer(computer.id,true,"CREATOR");
    computers.allocateComputer(computer.id,"OTHER-TASK","OTHER-SANDBOX");
    computers.startComputer(computer.id);

    const issued=authority.issueCapabilityToken({
      subject:context.agentId,
      taskId:context.taskId,
      sandboxId:context.sandboxId,
      environment:"test",
      capabilities:["task:execute","sandbox:run","computer:execute"],
      risk:"LOW",
      issuedBy:"CREATOR",
      issuedByKind:"CREATOR",
      expiresAt:new Date(Date.now()+300000).toISOString()
    });

    await expect(broker.executeComputerAuthorized({
      taskId:context.taskId,
      agentId:context.agentId,
      sandboxId:context.sandboxId,
      capabilityTokenId:issued.token.id,
      runId:context.runId,
      environment:"test",
      argv:["COMPUTER_USE"],
      computerId:computer.id,
      computerAction:"SCREENSHOT",
      computerInput:{}
    })).rejects.toThrow(/different task/);

    expect(authority.getCapabilityToken(issued.token.id)?.uses).toBe(0);
  });
});
