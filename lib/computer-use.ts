import {createStore} from "./persistence/store";
import {observe} from "./observability";
import type {Risk} from "./types";
export type ComputerUseKind="BROWSER"|"DESKTOP"|"CLI";
export type ComputerUseAction="NAVIGATE"|"CLICK"|"TYPE"|"SELECT"|"SCREENSHOT"|"OCR"|"PROCESS_READ"|"FILE_READ"|"TERMINAL_EXECUTE";
export type ComputerCapability={kind:ComputerUseKind;actions:ComputerUseAction[];environments:string[];network:"DENY"|"ALLOWLIST"|"INTERNET";risk:Risk};
export type ComputerInstance={id:string;name:string;kind:ComputerUseKind;os:string;arch:string;network:"DENY"|"ALLOWLIST"|"INTERNET";capabilities:ComputerCapability[];authorized:boolean;state:"AVAILABLE"|"ALLOCATED"|"EXECUTING"|"PAUSED"|"FAILED"|"RELEASED";sandboxId?:string;taskId?:string};
type Payload={instances:ComputerInstance[]};
const store=createStore<Payload>("computer-use",1,()=>({instances:[{
 id:"CMP-LOCAL-BROWSER",name:"Browser Sandbox",kind:"BROWSER",os:"sandbox",arch:"x64",network:"DENY",
 capabilities:[{kind:"BROWSER",actions:["NAVIGATE","CLICK","TYPE","SELECT","SCREENSHOT","OCR"],environments:["browser","test","experiment"],network:"DENY",risk:"MODERATE"}],
 authorized:false,state:"AVAILABLE"
}]}));
const instances:ComputerInstance[]=store.read().instances;
const persist=()=>store.write({instances});
const clone=<T,>(x:T):T=>structuredClone(x);
export function registerComputer(input:Omit<ComputerInstance,"id"|"state">){
  if(!input||typeof input!=="object")throw new Error("computer required");
  if(typeof input.name!=="string"||input.name.trim().length===0)throw new Error("computer name required");
  if(typeof input.kind!=="string"||input.kind.trim().length===0)throw new Error("computer kind required");
  // Discovery ist keine Autorisierung: ein registrierter Computer kommt **immer**
  // unautorisiert in die Flotte. Ein im Aufruf mitgeschicktes `authorized:true`
  // wird verworfen — es hätte keinen `computer.authorized`-Nachweis in der
  // Audit-Kette erzeugt und die Autorisierung wäre nicht nachvollziehbar.
  const x={...input,id:"CMP-"+Date.now(),authorized:false,state:"AVAILABLE" as const};instances.push(x);persist();observe({type:"computer.registered",message:`Computer ${x.id} registriert`,status:"COMPLETED",actor:"CREATOR",action:"computer.register",resource:x.id});return clone(x)}
export function allocateComputer(id:string,taskId:string,sandboxId?:string){const x=instances.find(i=>i.id===id);if(!x||!x.authorized)throw new Error("computer is not authorized");if(x.state!=="AVAILABLE")throw new Error("computer is not available");x.state="ALLOCATED";x.taskId=taskId;x.sandboxId=sandboxId;persist();observe({type:"computer.allocated",message:`Computer ${id} an ${taskId} gebunden`,status:"RUNNING",actor:"AG-BROWSER",agentId:"AG-BROWSER",taskId,sandboxId,action:"computer.allocate",resource:id});return clone(x)}
export function startComputer(id:string){const x=instances.find(i=>i.id===id);if(!x)throw new Error("computer not found");if(x.state!=="ALLOCATED")throw new Error("computer must be allocated first");x.state="EXECUTING";persist();observe({type:"computer.executing",message:`Computer ${id} führt aus`,status:"EXECUTING",actor:"AG-BROWSER",agentId:"AG-BROWSER",taskId:x.taskId,sandboxId:x.sandboxId,action:"computer.start",resource:id});return clone(x)}
export function authorizeComputer(id:string,authorized=true,actor="CREATOR"){const x=instances.find(i=>i.id===id);if(!x)throw new Error("computer not found");
  // Wie bei Geräten: die Autorisierung ist ein Creator-Akt. Die Route prüft das
  // bereits — die Domäne prüft es erneut, damit kein interner Pfad einen
  // beliebigen Actor in den Nachweis schreiben kann.
  if(actor!=="CREATOR")throw new Error("computer authorization requires Creator authority");x.authorized=authorized;persist();observe({type:"computer.authorized",message:`Computer ${id} ${authorized?"autorisiert":"Autorisierung entzogen"}`,status:"COMPLETED",actor,action:"computer.authorize",resource:id,decision:authorized?"ALLOW":"DENY",argumentsValue:{authorized}});return clone(x)}
export function releaseComputer(id:string){const x=instances.find(i=>i.id===id);if(!x)throw new Error("computer not found");x.state="RELEASED";x.taskId=undefined;x.sandboxId=undefined;persist();return clone(x)}

/**
 * Beansprucht einen Computer für **eine** Ausführung (Abschnitt 21).
 *
 * Die Prüfungen liegen bewusst in der Domäne und nicht nur im Broker: auch ein
 * interner Aufrufer kommt an einer Bindung nicht vorbei. Geprüft wird in dieser
 * Reihenfolge (fail closed, ohne Zustandsänderung bei Verstoß):
 *
 *  1. Instanz existiert,
 *  2. Instanz ist autorisiert (Discovery ≠ Autorisierung),
 *  3. Instanz gehört **genau** dieser Task (keine Fremdnutzung) und, wenn
 *     gesetzt, genau dieser Sandbox,
 *  4. Instanz ist reserviert oder läuft bereits (nicht `AVAILABLE`/`RELEASED`),
 *  5. Netzwerk ist nicht `INTERNET` (Default bleibt `DENY`),
 *  6. die Aktion ist von der Computer-Fähigkeit gedeckt.
 *
 * Erst danach wechselt der Zustand nach `EXECUTING`. Ein Verstoß verändert
 * nichts — der Nachweis entsteht als Verweigerung im Broker.
 */
export function assertComputerBinding(id:string,taskId:string,sandboxId:string|undefined,action:ComputerUseAction){
  const x=instances.find(i=>i.id===id);
  if(!x)throw new Error(`computer not found: ${id}`);
  if(!x.authorized)throw new Error(`computer ${id} is not authorized`);
  if(x.taskId!==taskId)throw new Error(`computer ${id} is allocated to a different task (${x.taskId??"none"})`);
  if(x.sandboxId&&sandboxId&&x.sandboxId!==sandboxId)throw new Error(`computer ${id} is bound to a different sandbox (${x.sandboxId})`);
  if(x.state!=="ALLOCATED"&&x.state!=="EXECUTING")throw new Error(`computer ${id} is not executable in state ${x.state}`);
  if(x.network==="INTERNET")throw new Error(`computer ${id} uses INTERNET networking; the network policy is DENY`);
  const granted=new Set(x.capabilities.flatMap(capability=>capability.actions));
  if(!granted.has(action))throw new Error(`action ${action} is not granted by the capability of computer ${id}`);
  return clone(x);
}

/** Setzt die geprüfte Bindung durch (`ALLOCATED` → `EXECUTING`). */
export function claimComputerExecution(id:string,taskId:string,sandboxId:string|undefined,action:ComputerUseAction){
  assertComputerBinding(id,taskId,sandboxId,action);
  const x=instances.find(i=>i.id===id)!;
  x.state="EXECUTING";persist();
  observe({type:"computer.executing",message:`Computer ${x.id} führt ${action} aus`,status:"EXECUTING",actor:"AG-BROWSER",agentId:"AG-BROWSER",taskId:x.taskId,sandboxId:x.sandboxId,action:"computer.execute",resource:x.id,argumentsValue:{action}});
  return clone(x);
}

/** Beendet eine Computer-Ausführung: Erfolg → `AVAILABLE`, Fehler → `FAILED`. */
export function completeComputerExecution(id:string,ok:boolean){
  const x=instances.find(i=>i.id===id);
  if(!x)throw new Error(`computer not found: ${id}`);
  x.state=ok?"AVAILABLE":"FAILED";
  x.taskId=undefined;x.sandboxId=undefined;persist();
  observe({type:ok?"computer.executed":"computer.failed",message:`Computer ${id} ${ok?"Ausführung beendet":"Ausführung fehlgeschlagen"}`,status:ok?"COMPLETED":"ERROR",actor:"AG-BROWSER",agentId:"AG-BROWSER",action:"computer.execute",resource:id,decision:ok?"ALLOW":"ERROR"});
  return clone(x);
}

export function computerUseStoreReport(){return store.integrity()}
export function listComputers(){return clone(instances)}
