import type {SkillDefinition,ToolLifecycle} from "./types";
const skills:SkillDefinition[]=[];
export function listSkills(){return structuredClone(skills)}
export function registerSkill(skill:SkillDefinition){if(skills.some(x=>x.id===skill.id))throw new Error("skill already exists");if(skill.lifecycle!=="VALIDATED"&&skill.lifecycle!=="REGISTERED")throw new Error("only validated skills can be registered");skills.push({...skill,lifecycle:"REGISTERED"});return structuredClone(skills[skills.length-1])}
export function transitionSkill(id:string,lifecycle:ToolLifecycle){const s=skills.find(x=>x.id===id);if(!s)throw new Error("skill not found");s.lifecycle=lifecycle;return structuredClone(s)}
