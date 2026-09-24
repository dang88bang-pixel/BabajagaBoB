import crypto from "node:crypto";
import {approvalGranted} from "./approvals";
import {documentStep} from "./gallery";
import {recordAudit} from "./audit";
import type {Risk} from "./types";

export type AppState="PLANNING"|"BUILDING"|"TESTING"|"SECURITY_VALIDATION"|"AWAITING_CONFIRMATION"|"INSTALLING"|"ACTIVE"|"PAUSED"|"FAILED"|"REMOVED";
export type ExecutableModule={
 id:string; appId:string; name:string; version:string; entrypoint:string; capabilities:string[]; risk:Risk;
 testsPassed:boolean; securityValidated:boolean; userConfirmationApprovalId?:string; state:"PROPOSED"|"VALIDATED"|"APPROVED"|"INSTALLED"|"DISABLED";
 createdAt:string; updatedAt:string;
};
export type ManagedApp={
 id:string; name:string; version:string; description:string; state:AppState; progress:number;
 createdAt:string; updatedAt:string; modules:string[];
};

const appStore=new Map<string,ManagedApp>();
const moduleStore=new Map<string,ExecutableModule>();

export function createApp(input:{name:string;version:string;description:string;taskId?:string}){
 const now=new Date().toISOString();
 const app:ManagedApp={id:"APP-"+crypto.randomUUID(),name:input.name,version:input.version,description:input.description,state:"PLANNING",progress:0,createdAt:now,updatedAt:now,modules:[]};
 appStore.set(app.id,app);
 documentStep({kind:"PLAN",title:"Application geplant",description:`Application ${app.name} wurde geplant`,status:"PLANNING",actor:"agent",appId:app.id,taskId:input.taskId});
 return structuredClone(app);
}
export function setAppState(appId:string,state:AppState,progress:number,taskId?:string){
 const app=appStore.get(appId);if(!app)throw new Error("app not found");
 app.state=state;app.progress=Math.max(0,Math.min(100,progress));app.updatedAt=new Date().toISOString();
 documentStep({kind:state==="TESTING"?"TEST":state==="SECURITY_VALIDATION"?"SECURITY":state==="INSTALLING"?"INSTALL":"NOTE",title:`App-Status: ${state}`,description:`${app.name}: Status auf ${state} gesetzt`,status:state==="FAILED"?"ERROR":state==="ACTIVE"?"COMPLETED":"RUNNING",actor:"agent",appId,taskId});
 return structuredClone(app);
}
export function registerExecutableModule(input:{appId:string;name:string;version:string;entrypoint:string;capabilities:string[];risk:Risk;testsPassed:boolean;securityValidated:boolean;taskId?:string}){
 const app=appStore.get(input.appId);if(!app)throw new Error("app not found");
 if(!input.testsPassed)throw new Error("executable module requires passing tests");
 if(!input.securityValidated)throw new Error("executable module requires security validation");
 const now=new Date().toISOString();
 const module:ExecutableModule={id:"MOD-"+crypto.randomUUID(),...input,state:"VALIDATED",createdAt:now,updatedAt:now};
 moduleStore.set(module.id,module);app.modules.push(module.id);app.updatedAt=now;
 documentStep({kind:"TEST",title:"Ausführbares Modul validiert",description:`Modul ${module.name} hat Tests und Sicherheitsvalidierung bestanden`,status:"COMPLETED",actor:"agent",appId:app.id,moduleId:module.id,taskId:input.taskId});
 return structuredClone(module);
}
export function installExecutableModule(moduleId:string,approvalId:string,taskId?:string){
 const module=moduleStore.get(moduleId);if(!module)throw new Error("module not found");
 if(module.state!=="VALIDATED")throw new Error("module is not validated");
 if(!approvalGranted(approvalId))throw new Error("explicit user confirmation is required");
 const app=appStore.get(module.appId)!;
 module.userConfirmationApprovalId=approvalId;module.state="APPROVED";module.updatedAt=new Date().toISOString();
 documentStep({kind:"APPROVAL",title:"Benutzerbestätigung erhalten",description:`Installation von ${module.name} wurde explizit bestätigt`,status:"COMPLETED",actor:"user",appId:app.id,moduleId,taskId,metadata:{approvalId}});
 app.state="INSTALLING";app.progress=95;app.updatedAt=new Date().toISOString();
 documentStep({kind:"INSTALL",title:"Ausführbares Modul installiert",description:`Modul ${module.name} wird nach bestätigter Validierung installiert`,status:"RUNNING",actor:"agent",appId:app.id,moduleId,taskId});
 module.state="INSTALLED";module.updatedAt=new Date().toISOString();app.state="ACTIVE";app.progress=100;app.updatedAt=new Date().toISOString();
 recordAudit({actor:"agent",action:"app.module.install",resource:moduleId,decision:"ALLOW"},{appId:app.id,moduleId,approvalId});
 documentStep({kind:"INSTALL",title:"Installation abgeschlossen",description:`Modul ${module.name} ist aktiv`,status:"COMPLETED",actor:"agent",appId:app.id,moduleId,taskId});
 return structuredClone({app,module});
}
export function listApps(){return structuredClone([...appStore.values()])}
export function getApp(id:string){return structuredClone(appStore.get(id)??null)}
export function listModules(appId?:string){return structuredClone([...moduleStore.values()].filter(m=>!appId||m.appId===appId))}
