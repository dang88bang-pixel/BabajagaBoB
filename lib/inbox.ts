export type InboxMode="INFORM"|"ASK"|"BLOCK";
export type InboxItem={id:string;mode:InboxMode;title:string;message:string;taskId?:string;createdAt:string;resolved:boolean};
const items:InboxItem[]=[];
const clone=<T,>(x:T):T=>structuredClone(x);
export function notifyInbox(x:Omit<InboxItem,"id"|"createdAt"|"resolved">){const i={...x,id:`IN-${Date.now()}-${items.length}`,createdAt:new Date().toISOString(),resolved:false};items.unshift(i);return clone(i)}
export function resolveInbox(id:string){const i=items.find(x=>x.id===id);if(!i)throw new Error("inbox item not found");i.resolved=true;return clone(i)}
export function listInbox(){return clone(items)}
