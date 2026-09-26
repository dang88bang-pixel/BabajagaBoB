import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

let root="";
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"bob-causal-"));process.env.BOB_STORAGE_DIR=root;process.env.BOB_SANDBOX_RUNTIME="local";process.env.BOB_BOOTSTRAP_SECRET=TEST_BOOTSTRAP_SECRET;vi.resetModules();});
afterEach(()=>{delete process.env.BOB_STORAGE_DIR;delete process.env.BOB_BOOTSTRAP_SECRET;fs.rmSync(root,{recursive:true,force:true});});

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
  // Die Kausalprüfung darf erst dann ESTABLISHED vergeben, wenn Baseline,
  // Kontrolle und Reproduktion *wirklich* beobachtet wurden (akzeptierte,
  // autorisierte Läufe mit nachvollziehbarer Beobachtung) und eine unabhängige
  // Evidenz vorliegt. Deshalb baut der Test eine reale Sandbox mit gültigem
  // Capability-Token auf — eine Behauptung ohne Lauf zählt nicht.
  const {completeBootstrap}=await import("../../lib/bootstrap");
  const cp=await import("../../lib/control-plane");
  const fabric=await import("../../lib/sandbox/fabric");
  const authority=await import("../../lib/authority");
  const {createExperiment,runExperiment,addEvidence,listEvidence,validateCausalChain}=await import("../../lib/science");
  const {upsertKnowledge}=await import("../../lib/knowledge");
  completeBootstrap({secret:TEST_BOOTSTRAP_SECRET,creatorName:"Kausal-Tester"});

  const mission=cp.createMission({title:"Kausalprüfung",objective:"Nachweis",createdBy:"CREATOR"});
  const objective=cp.createObjective({missionId:mission.missionId,title:"Objektiv",description:"Nachweis"});
  const task=cp.createTask({missionId:mission.missionId,objectiveId:objective.objectiveId,title:"Kausal-Task",risk:"LOW",assignedAgent:"AG-SCIENTIST",createdBy:"CREATOR"});
  const sandbox=await fabric.createSandbox({type:"test",taskId:task.taskId,agentId:"AG-SCIENTIST",risk:"LOW"});
  await fabric.startSandbox(sandbox.sandboxId);
  // Je Lauf eine eigene Autorisierung: Tokens sind standardmäßig einmalig
  // verwendbar (Replay-Schutz). Das wird hier nicht aufgeweicht.
  const issueFor=()=>authority.issueCapabilityToken({
   subject:"AG-SCIENTIST",taskId:task.taskId,sandboxId:sandbox.sandboxId,environment:"test",
   capabilities:["task:execute","sandbox:run"],risk:"LOW",issuedBy:"CREATOR",issuedByKind:"CREATOR",
   expiresAt:new Date(Date.now()+600_000).toISOString()
  });

  const exp=createExperiment({experimentId:"EXP-VALID-1",missionId:mission.missionId,objectiveId:objective.objectiveId,title:"Validation",taskId:task.taskId,agentId:"AG-SCIENTIST",sandboxId:sandbox.sandboxId,hypothesis:"x causes y",baseline:"baseline",control:"control",variables:["x"],confounders:[],expectedResult:"y changes",alternativeExplanations:[]});

  // Ohne Beobachtung: nur Hypothese, ausdrücklich nicht ESTABLISHED.
  const before=validateCausalChain(exp.experimentId);
  expect(before.knowledgeState).toBe("HYPOTHESIS");
  expect(before.valid).toBe(false);
  expect(before.reasons.join(" ")).toMatch(/baseline missing/);

  const execute=(kind:string,stdout:string)=>runExperiment({
   experimentId:exp.experimentId,kind:kind as never,sandboxId:sandbox.sandboxId,
   argv:["node","-e",`process.stdout.write('${stdout}')`],agentId:"AG-SCIENTIST",
   taskId:task.taskId,capabilityTokenId:issueFor().token.id,environment:"test"
  });
  const baseline=await execute("BASELINE","baseline-ok");
  const control=await execute("CONTROL","control-ok");
  const replication=await execute("REPLICATION","replicated");
  expect([baseline.accepted,control.accepted,replication.accepted]).toEqual([true,true,true]);
  expect(baseline.message.trim().length).toBeGreaterThan(0);

  // Zwischenstand: Läufe vorhanden, aber keine unabhängige Evidenz → nicht ESTABLISHED.
  const partial=validateCausalChain(exp.experimentId);
  expect(partial.knowledgeState).not.toBe("ESTABLISHED");
  expect(partial.reasons.join(" ")).toMatch(/no evidence recorded/);

  addEvidence({experimentId:exp.experimentId,kind:"REPRODUCTION",claim:"replicated",value:"verified",knowledgeState:"SUPPORTED"});
  const after=validateCausalChain(exp.experimentId);
  expect(after.valid).toBe(true);
  expect(after.reasons).toEqual([]);
  expect(after.knowledgeState).toBe("ESTABLISHED");
  expect(after.replicationRuns).toBe(1);
  expect(after.evidenceCount).toBe(1);

  const evidenceIds=listEvidence(exp.experimentId).map(e=>e.evidenceId);
  const k=upsertKnowledge({layer:"SEMANTIC",subject:"x",predicate:"causes",object:"y",state:"ESTABLISHED",evidenceIds,verification:"causal validation passed"});
  expect(k.confidence).toBe("EVIDENCE_BASED");
 });
});
