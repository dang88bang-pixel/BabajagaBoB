import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {Status} from "./types";
import {observe} from "./observability";

export type GalleryEntry={
 id:string; timestamp:string;
 kind:"PLAN"|"DESIGN"|"BUILD"|"TEST"|"SECURITY"|"EXPERIMENT"|"APPROVAL"|"INSTALL"|"RUN"|"ERROR"|"RECOVERY"|"NOTE";
 title:string; description:string; status:Status; actor:string;
 appId?:string; taskId?:string; moduleId?:string; parentId?:string; metadata?:Record<string,unknown>;
};

const root=()=>process.env.BOB_STORAGE_DIR??path.join(process.cwd(),".bob-data");
const file=()=>path.join(root(),"gallery.json");
const digest=(value:unknown)=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const load=():GalleryEntry[]=>{
 try{
  const raw=JSON.parse(fs.readFileSync(file(),"utf8")) as {version:1;entries:GalleryEntry[];digest:string};
  const {digest:stored,...payload}=raw;
  if(stored!==digest(payload)) throw new Error("Gallery persistence integrity check failed");
  return raw.entries;
 }catch(error){
  if(error instanceof Error&&error.message.includes("integrity")) throw error;
  return [];
 }
};
const entries:GalleryEntry[]=load();
const persist=()=>{
 fs.mkdirSync(root(),{recursive:true});
 const payload={version:1 as const,entries:structuredClone(entries)};
 const envelope={...payload,digest:digest(payload)};
 const tmp=path.join(root(),`.gallery.${process.pid}.${Date.now()}.tmp`);
 fs.writeFileSync(tmp,JSON.stringify(envelope,null,2),{encoding:"utf8",mode:0o600});
 fs.renameSync(tmp,file());
};

export function documentStep(input:Omit<GalleryEntry,"id"|"timestamp">){
 const entry={...input,id:"GAL-"+crypto.randomUUID(),timestamp:new Date().toISOString()};
 entries.unshift(entry); persist();
 observe({type:"gallery.step",message:entry.description,status:entry.status,actor:entry.actor,resource:entry.appId??entry.moduleId,taskId:entry.taskId,causalParentId:entry.parentId,action:"gallery.document",argumentsValue:{kind:entry.kind,title:entry.title,metadata:entry.metadata}});
 return structuredClone(entry);
}
export function listGallery(filter?:{appId?:string;taskId?:string;moduleId?:string}){return structuredClone(entries.filter(e=>(!filter?.appId||e.appId===filter.appId)&&(!filter?.taskId||e.taskId===filter.taskId)&&(!filter?.moduleId||e.moduleId===filter.moduleId)))}
export function gallerySnapshot(){return {count:entries.length,entries:listGallery()}}
