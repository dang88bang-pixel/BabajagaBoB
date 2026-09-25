import type {SkillDefinition,ToolLifecycle} from "./types";
import {createStore} from "./persistence/store";
/** Registrierte Skills sind Betriebszustand und überleben einen Neustart. */
const store=createStore<{skills:SkillDefinition[]}>("skills",1,()=>({skills:[]}));
export function listSkills(){return store.read().skills.map(x=>structuredClone(x))}
export function registerSkill(skill:SkillDefinition){const existing=store.read().skills;if(existing.some(x=>x.id===skill.id))throw new Error("skill already exists");const entry={...skill,lifecycle:"REGISTERED" as const};store.write({skills:[...existing,entry]});return structuredClone(entry)}
export function transitionSkill(id:string,lifecycle:ToolLifecycle){const list=store.read().skills;const s=list.find(x=>x.id===id);if(!s)throw new Error("skill not found");s.lifecycle=lifecycle;store.write({skills:list});return structuredClone(s)}
