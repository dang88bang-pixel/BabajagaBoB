import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {recordAudit} from "./audit";
import {observe} from "./observability";

type DeviceAttestation = {
  deviceId:string;
  publicKeyPem:string;
  fingerprint:string;
  registeredAt:string;
  lastVerifiedAt?:string;
  nonce?:string;
  nonceExpiresAt?:string;
};
type Payload={devices:DeviceAttestation[]};
const store=createStore<Payload>("device-attestation",1,()=>({devices:[]}));
const clone=<T,>(v:T):T=>structuredClone(v);
const fingerprint=(pem:string)=>crypto.createHash("sha256").update(pem).digest("hex");
const canonical=(deviceId:string,nonce:string)=>Buffer.from(JSON.stringify({deviceId,nonce}),"utf8");

function validId(id:string){return /^[A-Za-z0-9._-]{3,64}$/.test(id);}
function get(id:string){return store.read().devices.find(x=>x.deviceId===id);}

export function registerDeviceAttestation(deviceId:string,publicKeyPem:string){
  if(!validId(deviceId)) throw new Error("invalid device id");
  if(typeof publicKeyPem!=="string" || publicKeyPem.length>10000) throw new Error("invalid public key");
  const key=crypto.createPublicKey(publicKeyPem);
  if(key.asymmetricKeyType!=="ed25519") throw new Error("device attestation requires Ed25519");
  const entry:DeviceAttestation={deviceId,publicKeyPem:key.export({type:"spki",format:"pem"}).toString(),fingerprint:fingerprint(key.export({type:"spki",format:"pem"}).toString()),registeredAt:new Date().toISOString()};
  store.update(p=>{p.devices=p.devices.filter(x=>x.deviceId!==deviceId);p.devices.push(entry);});
  recordAudit({actor:"AGENT-ENROLLMENT",action:"device.attestation.register",resource:deviceId,decision:"ALLOW"},{fingerprint:entry.fingerprint});
  return clone(entry);
}

export function issueAttestationChallenge(deviceId:string){
  const entry=get(deviceId); if(!entry) throw new Error("device attestation key not registered");
  const nonce=crypto.randomBytes(32).toString("base64url");
  const expiresAt=new Date(Date.now()+60_000).toISOString();
  store.update(p=>{const x=p.devices.find(d=>d.deviceId===deviceId); if(x){x.nonce=nonce;x.nonceExpiresAt=expiresAt;}});
  return {deviceId,nonce,expiresAt,fingerprint:entry.fingerprint};
}

export function verifyDeviceAttestation(deviceId:string,nonce:string,signature:string){
  const entry=get(deviceId); if(!entry) return {verified:false,reason:"attestation key not registered"};
  if(entry.nonce!==nonce) return {verified:false,reason:"challenge mismatch"};
  if(!entry.nonceExpiresAt || Date.parse(entry.nonceExpiresAt)<=Date.now()) return {verified:false,reason:"challenge expired"};
  let ok=false;
  try { ok=crypto.verify(null,canonical(deviceId,nonce),crypto.createPublicKey(entry.publicKeyPem),Buffer.from(signature,"base64url")); } catch { ok=false; }
  if(!ok) return {verified:false,reason:"invalid attestation signature"};
  store.update(p=>{const x=p.devices.find(d=>d.deviceId===deviceId);if(x){x.lastVerifiedAt=new Date().toISOString();x.nonce=undefined;x.nonceExpiresAt=undefined;}});
  recordAudit({actor:"AGENT-ENROLLMENT",action:"device.attestation.verify",resource:deviceId,decision:"ALLOW"},{fingerprint:entry.fingerprint});
  observe({type:"device.attested",message:`Gerät ${deviceId} kryptographisch attestiert`,status:"COMPLETED",actor:"AGENT-ENROLLMENT",action:"device.attestation.verify",resource:deviceId,decision:"ALLOW",argumentsValue:{fingerprint:entry.fingerprint}});
  return {verified:true,fingerprint:entry.fingerprint};
}
export function listDeviceAttestations(){return clone(store.read().devices).map(x=>({...x,publicKeyPem:undefined,nonce:undefined,nonceExpiresAt:undefined}));}
