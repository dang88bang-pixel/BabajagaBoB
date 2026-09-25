import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

let root="";
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"bob-causal-"));process.env.BOB_STORAGE_DIR=root;vi.resetModules();});
afterEach(()=>{delete process.env.BOB_STORAGE_DIR;fs.rmSync(root,{recursive:true,force:true});});

describe("causal integrity",()=>{
 it("rejects ESTABLISHED knowledge without evidence and verification",async()=>{
  const {upsertKnowledge}=await import("../../lib/knowledge");
  expect(()=>upsertKnowledge({layer:"SEMANTIC",subject:"x",predicate:"works",object:"y",state:"ESTABLISHED"})).toThrow(/evidenceIds/);
  expect(()=>upsertKnowledge({layer:"SEMANTIC",subject:"x",predicate:"works",object:"y",state:"ESTABLISHED",evidenceIds:["EVD-1"]})).toThrow(/verification/);
  const node=upsertKnowledge({layer:"SEMANTIC",subject:"x",predicate:"works",object:"y",state:"ESTABLISHED",evidenceIds:["EVD-1"],verification:"verified by reproduction"});
  expect(node.state).toBe("ESTABLISHED");
 });

 it("rejects direct experiment promotion to ESTABLISHED",async()=>{
  const {createExperiment,updateExperiment}=await import("../../lib/science");
  const experiment=createExperiment({
   experimentId:"EXP-CAUSAL-1",missionId:"MIS-1",objectiveId:"OBJ-1",title:"Causal guard",
   taskId:"TASK-1",agentId:"AG-SCIENTIST",sandboxId:"SB-1",hypothesis:"x causes y",
   baseline:"baseline",control:"control",variables:["x"],confounders:[],
   expectedResult:"y changes",alternativeExplanations:[]
  });
  expect(()=>updateExperiment(experiment.experimentId,{knowledgeState:"ESTABLISHED"})).toThrow(/validateCausalChain/);
 });
});


describe("causal validation",()=>{
 it("requires accepted, evidenced baseline/control/replication observations",async()=>{
  const {createExperiment,runExperiment,addEvidence,validateCausalChain}=await import("../../lib/science");
  const {upsertKnowledge}=await import("../../lib/knowledge");
  const exp=createExperiment({experimentId:"EXP-VALID-1",missionId:"MIS-1",objectiveId:"OBJ-1",title:"Validation",taskId:"TASK-1",agentId:"AG-SCIENTIST",sandboxId:"SB-1",hypothesis:"x causes y",baseline:"baseline",control:"control",variables:["x"],confounders:[],expectedResult:"y changes",alternativeExplanations:[]});
  const before=validateCausalChain(exp.experimentId); expect(before.knowledgeState).not.toBe("ESTABLISHED");
  await runExperiment(exp.experimentId,"BASELINE","SB-1",["true"],"");
  await runExperiment(exp.experimentId,"CONTROL","SB-1",["true"],"");
  await runExperiment(exp.experimentId,"REPLICATION","SB-1",["true"],"replicated");
  addEvidence({experimentId:exp.experimentId,kind:"REPRODUCTION",claim:"replicated",value:"verified"});
  const after=validateCausalChain(exp.experimentId); expect(after.knowledgeState).toBe("ESTABLISHED");
  const k=upsertKnowledge({layer:"SEMANTIC",subject:"x",predicate:"causes",object:"y",state:"ESTABLISHED",evidenceIds:after.evidenceCount?exp.evidenceIds:[],verification:"causal validation passed"}); expect(k.confidence).toBe("EVIDENCE_BASED");
 });
});
