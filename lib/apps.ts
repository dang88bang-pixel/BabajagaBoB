import crypto from "node:crypto";
import {approvalGranted} from "./approvals";
import {documentStep} from "./gallery";
import {recordAudit} from "./audit";
import {sandboxRuntime} from "./runtime";
import {executionGate} from "./execution-gate";
import {getControlState} from "./control-plane";
import type {Risk} from "./types";

export type AppState="PLANNING"|"BUILDING"|"TESTING"|"SECURITY_VALIDATION"|"AWAITING_CONFIRMATION"|"INSTALLING"|"ACTIVE"|"PAUSED"|"FAILED"|"REMOVED";
export type ExecutableModule={
 id:string; appId:string; name:string; version:string; entrypoint:string; capabilities:string[]; risk:Risk;
 testsPassed:boolean; securityValidated:boolean; userConfirmationApprovalId?:string; sandboxId?:string; state:"PROPOSED"|"VALIDATED"|"APPROVED"|"INSTALLING"|"INSTALLED"|"RUNNING"|"PAUSED"|"DISABLED";
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
 moduleStore.set(module.id,module);app.modules.push(module.id);app.state="AWAITING_CONFIRMATION";app.progress=90;app.updatedAt=now;
 documentStep({kind:"TEST",title:"Ausführbares Modul validiert",description:`Modul ${module.name} hat Tests und Sicherheitsvalidierung bestanden`,status:"COMPLETED",actor:"agent",appId:app.id,moduleId:module.id,taskId:input.taskId});
 return structuredClone(module);
}
export async function installExecutableModule(moduleId:string,approvalId:string,taskId?:string){
 const module=moduleStore.get(moduleId);if(!module)throw new Error("module not found");
 if(module.state!=="VALIDATED")throw new Error("module is not validated");
 const app=appStore.get(module.appId);if(!app)throw new Error("app not found");
 if(app.state!=="AWAITING_CONFIRMATION")throw new Error("app must complete planning, testing and security validation before confirmation");
 if(!approvalGranted(approvalId))throw new Error("explicit user confirmation is required");
 module.userConfirmationApprovalId=approvalId;module.state="APPROVED";module.updatedAt=new Date().toISOString();
 documentStep({kind:"APPROVAL",title:"Benutzerbestätigung erhalten",description:`Installation von ${module.name} wurde explizit bestätigt`,status:"COMPLETED",actor:"user",appId:app.id,moduleId,taskId,metadata:{approvalId}});
 app.state="INSTALLING";app.progress=95;app.updatedAt=new Date().toISOString();
 documentStep({kind:"INSTALL",title:"Isolierte Sandbox wird vorbereitet",description:`Modul ${module.name} erhält eine dedizierte Sandbox mit Netzwerk DENY`,status:"RUNNING",actor:"agent",appId:app.id,moduleId,taskId});
 const sandboxId=`SB-APP-${module.id}`;
 await sandboxRuntime.create({id:sandboxId,type:"application-module",network:{mode:"DENY",allowlist:[]},limits:{cpuMillicores:500,memoryMb:512,storageMb:2048,timeoutMs:120000,processes:16},risk:module.risk});
 module.sandboxId=sandboxId;
 module.state="INSTALLED";module.updatedAt=new Date().toISOString();app.state="ACTIVE";app.progress=100;app.updatedAt=new Date().toISOString();
 recordAudit({actor:"agent",action:"app.module.install",resource:moduleId,decision:"ALLOW"},{appId:app.id,moduleId,approvalId});
 documentStep({kind:"INSTALL",title:"Installation abgeschlossen",description:`Modul ${module.name} ist aktiv in Sandbox ${module.sandboxId}`,status:"COMPLETED",actor:"agent",appId:app.id,moduleId,taskId});
 return structuredClone({app,module});
}
export function listApps(){return structuredClone([...appStore.values()])}
export function getApp(id:string){return structuredClone(appStore.get(id)??null)}
export function listModules(appId?:string){return structuredClone([...moduleStore.values()].filter(m=>!appId||m.appId===appId))}


export async function startExecutableModule(moduleId:string,taskId?:string){
 const module=moduleStore.get(moduleId); if(!module) throw new Error("module not found");
 const app=appStore.get(module.appId); if(!app) throw new Error("app not found");
 if(module.state!=="INSTALLED"&&module.state!=="PAUSED") throw new Error("module must be installed");
 if(taskId){ const task=getControlState().tasks.find(t=>t.id===taskId); if(!task) throw new Error("task not found"); const gate=executionGate(task,module.userConfirmationApprovalId,getControlState().locked,undefined,undefined,module.sandboxId); if(!gate.allowed) throw new Error(`execution blocked: ${gate.reasons.join("; ")}`); }
 if(!module.sandboxId) throw new Error("module has no sandbox");
 await sandboxRuntime.start(module.sandboxId);
 module.state="RUNNING"; app.state="ACTIVE"; app.progress=100; module.updatedAt=new Date().toISOString(); app.updatedAt=module.updatedAt;
 documentStep({kind:"RUN",title:"Ausführbares Modul gestartet",description:`Modul ${module.name} läuft isoliert in Sandbox ${module.sandboxId}`,status:"RUNNING",actor:"agent",appId:app.id,moduleId,taskId});
 return structuredClone({app,module});
}
export async function pauseExecutableModule(moduleId:string){
 const module=moduleStore.get(moduleId); if(!module||!module.sandboxId) throw new Error("module sandbox not found");
 await sandboxRuntime.pause(module.sandboxId); module.state="PAUSED"; module.updatedAt=new Date().toISOString();
 documentStep({kind:"RUN",title:"Ausführbares Modul pausiert",description:`Modul ${module.name} wurde pausiert`,status:"WAITING",actor:"agent",appId:module.appId,moduleId});
 return structuredClone(module);
}
