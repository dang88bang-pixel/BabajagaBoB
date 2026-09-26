import {beforeAll,describe,expect,it,vi} from "vitest";
import {isolatedStorageRoot} from "../helpers/runtime";

isolatedStorageRoot("unit-plans");
let cp:typeof import("../../lib/control-plane");
let plans:typeof import("../../lib/plans");

beforeAll(async()=>{vi.resetModules();cp=await import("../../lib/control-plane");plans=await import("../../lib/plans");});

describe("versionierte Execution-Pläne",()=>{
  it("erzeugt einen persistenten Plan aus Objective und zugehörigen Tasks",()=>{
    const mission=cp.createMission({title:"Plan-Mission",objective:"Planung",createdBy:"CREATOR"});
    const objective=cp.createObjective({missionId:mission.missionId,title:"Plan-Objective",description:"Ausführung planen"});
    const task=cp.createTask({missionId:mission.missionId,objectiveId:objective.objectiveId,title:"Plan-Task",risk:"LOW",createdBy:"CREATOR"});
    const plan=plans.createPlan({objectiveId:objective.objectiveId,taskIds:[task.taskId],expectedEffects:["Task wird kontrolliert ausgeführt"],abortCriteria:["Fehlerquote > 0","Evidenz fehlt"],createdBy:"CREATOR"});
    expect(plan.planId).toMatch(/^PLAN-/); expect(plan.version).toBe(1); expect(plan.status).toBe("DRAFT");
    expect(plans.getPlan(plan.planId)?.steps[0].taskId).toBe(task.taskId);
  });
  it("inkrementiert Versionen je Objective",()=>{
    const mission=cp.createMission({title:"Version-Mission",objective:"Versionierung",createdBy:"CREATOR"});
    const objective=cp.createObjective({missionId:mission.missionId,title:"Version-Objective",description:"Versionen"});
    const task=cp.createTask({missionId:mission.missionId,objectiveId:objective.objectiveId,title:"Task",risk:"LOW",createdBy:"CREATOR"});
    const a=plans.createPlan({objectiveId:objective.objectiveId,taskIds:[task.taskId],expectedEffects:["A"],abortCriteria:["B"],createdBy:"CREATOR"});
    const b=plans.createPlan({objectiveId:objective.objectiveId,taskIds:[task.taskId],expectedEffects:["C"],abortCriteria:["D"],createdBy:"CREATOR"});
    expect(a.version).toBe(1); expect(b.version).toBe(2);
  });
  it("verweigert Tasks aus einem anderen Objective",()=>{
    const mission=cp.createMission({title:"Bind-Mission",objective:"Bindung",createdBy:"CREATOR"});
    const a=cp.createObjective({missionId:mission.missionId,title:"A",description:"A"});
    const b=cp.createObjective({missionId:mission.missionId,title:"B",description:"B"});
    const task=cp.createTask({missionId:mission.missionId,objectiveId:b.objectiveId,title:"B-Task",risk:"LOW",createdBy:"CREATOR"});
    expect(()=>plans.createPlan({objectiveId:a.objectiveId,taskIds:[task.taskId],expectedEffects:["x"],abortCriteria:["y"],createdBy:"CREATOR"})).toThrow(/belong/i);
  });
  it("verlangt erwartete Wirkung und Abbruchkriterien",()=>{
    const mission=cp.createMission({title:"Required",objective:"Required",createdBy:"CREATOR"});
    const objective=cp.createObjective({missionId:mission.missionId,title:"Obj",description:"Obj"});
    const task=cp.createTask({missionId:mission.missionId,objectiveId:objective.objectiveId,title:"Task",risk:"LOW",createdBy:"CREATOR"});
    expect(()=>plans.createPlan({objectiveId:objective.objectiveId,taskIds:[task.taskId],expectedEffects:[],abortCriteria:["x"],createdBy:"CREATOR"})).toThrow(/expectedEffects/i);
    expect(()=>plans.createPlan({objectiveId:objective.objectiveId,taskIds:[task.taskId],expectedEffects:["x"],abortCriteria:[],createdBy:"CREATOR"})).toThrow(/abortCriteria/i);
  });
  it("aktiviert nur einen Entwurf und bleibt persistiert",()=>{
    const mission=cp.createMission({title:"Activate",objective:"Activate",createdBy:"CREATOR"});
    const objective=cp.createObjective({missionId:mission.missionId,title:"Obj",description:"Obj"});
    const task=cp.createTask({missionId:mission.missionId,objectiveId:objective.objectiveId,title:"Task",risk:"LOW",createdBy:"CREATOR"});
    const plan=plans.createPlan({objectiveId:objective.objectiveId,taskIds:[task.taskId],expectedEffects:["x"],abortCriteria:["y"],createdBy:"CREATOR"});
    expect(plans.activatePlan(plan.planId).status).toBe("ACTIVE");
    expect(plans.getPlan(plan.planId)?.status).toBe("ACTIVE");
    expect(()=>plans.activatePlan(plan.planId)).toThrow(/DRAFT/i);
  });
  it("filtert Pläne nach Objective",()=>{
    expect(plans.listPlans("OBJ-NOT-FOUND")).toEqual([]);
  });
});
