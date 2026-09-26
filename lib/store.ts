import type {ControlState} from "./types";
import type {Artifact} from "./artifacts";
import type {AuditRecord} from "./audit";
export interface ControlStore{getControlState():ControlState;saveControlState(state:ControlState):void;appendAudit(record:AuditRecord):void;listAudit():AuditRecord[];appendArtifact(artifact:Artifact):void;listArtifacts():Artifact[]}
export class InMemoryControlStore implements ControlStore{
 private state:ControlState; private audits:AuditRecord[]=[]; private artifacts:Artifact[]=[];
 constructor(initial:ControlState){this.state=structuredClone(initial)}
 getControlState(){return structuredClone(this.state)}
 saveControlState(state:ControlState){this.state=structuredClone(state)}
 appendAudit(record:AuditRecord){this.audits.push(structuredClone(record))}
 listAudit(){return this.audits.map(x=>structuredClone(x))}
 appendArtifact(artifact:Artifact){this.artifacts.push(structuredClone(artifact))}
 listArtifacts(){return this.artifacts.map(x=>structuredClone(x))}
}
