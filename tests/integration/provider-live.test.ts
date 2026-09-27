import {beforeEach,describe,expect,it} from "vitest";
import {createApproval,resolveApprovalRequest} from "../../lib/approvals";
import {connectProvider,getProvider} from "../../lib/provider-fabric";
describe("live provider connection",()=>{
 beforeEach(()=>{process.env.BOB_STORAGE_DIR="/tmp/bob-provider-live-"+Date.now()+"-"+Math.random().toString(16).slice(2);});
 it("performs a real HTTPS probe and only connects after Creator approval",async()=>{
  const approval=createApproval({taskId:"TASK-PROVIDER-LIVE",requestedBy:"AG-INT",changeSummary:"Live probe GitHub public API",why:"verify managed external provider path",expectedEffect:"HTTPS metadata health response",risks:["external network access"],testResults:["live provider integration test"],rollbackPlan:"disconnect provider",files:[],dbChanges:[],networkEffects:["HTTPS GET api.github.com"],affectedSystems:["GitHub Public API"],status:"PENDING" as never});
  resolveApprovalRequest(approval.approvalId,"GRANTED","CREATOR","explicit live-provider verification");
  const p=getProvider("prov-github-public-api"); expect(p?.endpoint).toContain("api.github.com");
  const connected=await connectProvider("prov-github-public-api",p?.endpoint,undefined,approval.approvalId);
  expect(connected.lifecycle).toBe("CONNECTED"); expect(connected.health).toBe("HEALTHY"); expect(connected.enabled).toBe(true);
 },15000);
});