export type Status="QUEUED"|"PLANNING"|"RUNNING"|"THINKING"|"EXECUTING"|"EXPERIMENT"|"TESTING"|"WAITING"|"BLOCKED"|"APPROVAL_REQUIRED"|"ERROR"|"RECOVERING"|"ROLLING_BACK"|"COMPLETED"|"CANCELLED";
export type Agent={id:string;name:string;role:string;status:Status;progress:number;task:string};
export type Event={id:string;message:string;status:Status;time:string};
export type Mission={id:string;title:string;status:Status;progress:number;owner:string};
export type Experiment={id:string;title:string;status:Status;progress:number;sandbox:string};
export type Sandbox={id:string;type:string;status:Status;network:string;task:string};