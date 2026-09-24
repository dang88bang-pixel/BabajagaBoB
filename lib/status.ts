import type {Status} from "./types";
export const statusLabel=(s:Status)=>s.replaceAll("_"," ");
export const statusTone=(s:Status)=>s.toLowerCase().replaceAll("_","-");