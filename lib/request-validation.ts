import {precheckCapabilityToken} from "./authority";

export async function readJson(request:Request):Promise<Record<string,unknown>>{
  const type=request.headers.get("content-type")??"";
  if(!type.toLowerCase().includes("application/json")) throw new Error("application/json required");
  const raw=await request.text();
  if(raw.length>256_000) throw new Error("request body too large");
  let value:unknown;
  try{value=JSON.parse(raw)}catch{throw new Error("invalid JSON")}
  if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error("JSON object required");
  return value as Record<string,unknown>;
}
export function stringField(body:Record<string,unknown>,key:string,max=4096){
  const value=body[key];
  if(typeof value!=="string"||value.trim().length===0||value.length>max) throw new Error(`invalid ${key}`);
  return value;
}
export function optionalString(body:Record<string,unknown>,key:string,max=4096){
  const value=body[key];
  if(value===undefined||value===null)return undefined;
  if(typeof value!=="string"||value.length>max) throw new Error(`invalid ${key}`);
  return value;
}
export function actionField(body:Record<string,unknown>,allowed:string[]){
  const action=stringField(body,"action",80);
  if(!allowed.includes(action)) throw new Error("unsupported action");
  return action;
}
export function stringArray(value:unknown,key:string,maxItems=100,maxItemLength=4096){
  if(!Array.isArray(value)||value.length>maxItems||value.some(x=>typeof x!=="string"||x.length===0||x.length>maxItemLength)) throw new Error(`invalid ${key}`);
  return value as string[];
}
/**
 * Vorprüfung für Nicht-Ausführungs-Aktionen (z. B. Approval-Auflösung).
 * Authentizität, Scope, Ablauf und Widerruf werden geprüft; der Verbrauch des
 * Tokens wird nur bei Ausführungen im Execution Broker durchgesetzt.
 */
export function requireCapability(tokenId:string|undefined,capability:string){
  if(!tokenId) throw new Error("capability token required");
  const result=precheckCapabilityToken(tokenId,[capability]);
  if(!result.valid) throw new Error(result.reason);
}
