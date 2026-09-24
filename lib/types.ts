export type Status="QUEUED"|"PLANNING"|"RUNNING"|"THINKING"|"EXECUTING"|"EXPERIMENT"|"TESTING"|"WAITING"|"BLOCKED"|"APPROVAL_REQUIRED"|"ERROR"|"RECOVERING"|"ROLLING_BACK"|"COMPLETED"|"CANCELLED";
export type Risk="SAFE"|"LOW"|"MODERATE"|"HIGH"|"CRITICAL";
export type KnowledgeState="OBSERVED"|"SUPPORTED"|"ESTABLISHED"|"HYPOTHESIS"|"UNVERIFIED"|"CONTRADICTED"|"REJECTED"|"UNKNOWN";
export type Agent={id:string;name:string;role:string;status:Status;progress:number;task:string;capabilities:string[]};
export type Event={id:string;type:string;message:string;status:Status;time:string;actor:string;taskId?:string;resource?:string;causalParentId?:string};
export type Mission={id:string;title:string;status:Status;progress:number;owner:string;objective:string};
export type Experiment={id:string;title:string;status:Status;progress:number;sandbox:string;hypothesis:string;knowledgeState:KnowledgeState};
export type Sandbox={id:string;type:string;status:Status;network:"DENY"|"ALLOWLIST";task:string;agentId:string};
export type Task={id:string;missionId:string;title:string;status:Status;progress:number;risk:Risk;assignedAgent:string;requiresApproval:boolean};
export type Approval={id:string;taskId:string;status:"PENDING"|"GRANTED"|"DENIED";reason:string};
export type ToolLifecycle="DRAFT"|"PROTOTYPE"|"TESTING"|"VALIDATED"|"REGISTERED"|"DEPRECATED";
export type SkillDefinition={id:string;name:string;version:string;tools:string[];lifecycle:ToolLifecycle;provenance:string;validation:string[]};

export type ControlState={agents:Agent[];missions:Mission[];tasks:Task[];experiments:Experiment[];sandboxes:Sandbox[];events:Event[];approvals:Approval[];locked:boolean};
