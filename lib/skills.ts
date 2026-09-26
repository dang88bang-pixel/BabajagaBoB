import type {SkillDefinition,ToolLifecycle} from "./types";
import {createStore} from "./persistence/store";
/** Registrierte Skills sind Betriebszustand und überleben einen Neustart. */
const store=createStore<{skills:SkillDefinition[]}>("skills",1,()=>({skills:[]}));
export function listSkills(){return store.read().skills.map(x=>structuredClone(x))}
export function registerSkill(skill:SkillDefinition){
  // Identität ist Pflicht: ein Eintrag ohne `id`/`name` wäre nicht ansprechbar und
  // würde jede spätere Registrierung als "already exists" blockieren.
  if(!skill||typeof skill!=="object")throw new Error("skill definition required");
  if(typeof skill.id!=="string"||skill.id.trim().length===0)throw new Error("skill id required");
  if(typeof skill.name!=="string"||skill.name.trim().length===0)throw new Error("skill name required");
  if(typeof skill.version!=="string"||skill.version.trim().length===0)throw new Error("skill version required");
  if(!Array.isArray(skill.tools))throw new Error("skill tools required");
  const existing=store.read().skills;if(existing.some(x=>x.id===skill.id))throw new Error("skill already exists");
  const entry={...skill,lifecycle:"REGISTERED" as const};store.write({skills:[...existing,entry]});return structuredClone(entry);
}
export function transitionSkill(id:string,lifecycle:ToolLifecycle){const list=store.read().skills;const s=list.find(x=>x.id===id);if(!s)throw new Error("skill not found");s.lifecycle=lifecycle;store.write({skills:list});return structuredClone(s)}
