import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

let root="";
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"bob-events-"));process.env.BOB_STORAGE_DIR=root;vi.resetModules();});
afterEach(()=>{delete process.env.BOB_STORAGE_DIR;fs.rmSync(root,{recursive:true,force:true});});

describe("canonical event/audit linkage",()=>{
  it("assigns temporal parents and links the audit record to the exact event",async()=>{
    const {observe}=await import("../../lib/observability");
    const {verifyEventChain}=await import("../../lib/events/log");
    const {auditSnapshot,verifyAuditChain}=await import("../../lib/audit");

    const first=observe({type:"test.first",message:"first",status:"COMPLETED",actor:"TEST",action:"test.first",resource:"TASK-1"});
    const second=observe({type:"test.second",message:"second",status:"COMPLETED",actor:"TEST",action:"test.second",resource:"TASK-1"});

    expect(second.causalParentId).toBe(first.eventId);
    expect(second.parentDirection).toBe("PREVIOUS");
    expect(verifyEventChain().valid).toBe(true);

    const audit=auditSnapshot(2);
    expect(audit.some(record=>record.eventId===first.eventId)).toBe(true);
    expect(audit.some(record=>record.eventId===second.eventId)).toBe(true);
    expect(verifyAuditChain().valid).toBe(true);
  });

  it("rejects a fabricated causal reference during verification",async()=>{
    const {appendDomainEvent,verifyEventChain}=await import("../../lib/events/log");
    appendDomainEvent({type:"test",message:"fabricated",status:"COMPLETED",actor:"TEST",causedBy:["EVT-does-not-exist"]});
    const result=verifyEventChain();
    expect(result.valid).toBe(false);
    expect(result.issues.some(issue=>issue.includes("unknown causedBy reference"))).toBe(true);
  });
});
