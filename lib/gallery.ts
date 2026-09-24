import crypto from "node:crypto";
import {observe} from "./observability";
import {recordAudit} from "./audit";
import type {Status} from "./types";

export type GalleryEntry={
 id:string;
 timestamp:string;
 kind:"PLAN"|"DESIGN"|"BUILD"|"TEST"|"SECURITY"|"EXPERIMENT"|"APPROVAL"|"INSTALL"|"RUN"|"ERROR"|"RECOVERY"|"NOTE";
 title:string;
 description:string;
 status:Status;
 actor:string;
 appId?:string;
 taskId?:string;
 moduleId?:string;
 parentId?:string;
 metadata?:Record<string,unknown>;
};

const entries:GalleryEntry[]=[];
export function documentStep(input:Omit<GalleryEntry,"id"|"timestamp">){
 const entry={...input,id:"GAL-"+crypto.randomUUID(),timestamp:new Date().toISOString()};
 entries.unshift(entry);
 observe({type:"gallery.step",message:entry.description,status:entry.status,actor:entry.actor,resource:entry.appId??entry.moduleId,taskId:entry.taskId,causalParentId:entry.parentId,action:"gallery.document",argumentsValue:{kind:entry.kind,title:entry.title,metadata:entry.metadata}});
 return structuredClone(entry);
}
export function listGallery(filter?:{appId?:string;taskId?:string;moduleId?:string}){return structuredClone(entries.filter(e=>(!filter?.appId||e.appId===filter.appId)&&(!filter?.taskId||e.taskId===filter.taskId)&&(!filter?.moduleId||e.moduleId===filter.moduleId)))}
export function gallerySnapshot(){return {count:entries.length,entries:listGallery()}}
