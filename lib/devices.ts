export type DeviceTrust="LOCAL_TRUSTED"|"MANAGED"|"EPHEMERAL"|"EXPERIMENTAL"|"RESTRICTED"|"OBSERVATION_ONLY";
export type DeviceNetwork="INTERNET"|"LAN"|"VPN"|"NONE"|"ALLOWLIST";
export type DeviceState="UNKNOWN"|"DISCOVERED"|"IDENTIFIED"|"TRUSTED"|"AUTHORIZED"|"AVAILABLE"|"ALLOCATED"|"EXECUTING"|"RESULT"|"RELEASED";
export type Device={id:string;name:string;os:string;arch:string;cpu:number;ramMb:number;gpu?:string;network:DeviceNetwork;trust:DeviceTrust;state:DeviceState;capabilities:string[];authorized:boolean;currentTaskId?:string;lastSeen:string};
const devices:Device[]=[
 {id:"DEV-LOCAL",name:"Control Host",os:"linux",arch:"x64",cpu:8,ramMb:16384,gpu:"none",network:"NONE",trust:"LOCAL_TRUSTED",state:"AVAILABLE",capabilities:["node","python","container"],authorized:true,lastSeen:new Date().toISOString()}
];
const clone=<T,>(v:T):T=>structuredClone(v);
export function listDevices(){return clone(devices)}
export function discoverDevice(device:Omit<Device,"authorized"|"state">){const existing=devices.find(d=>d.id===device.id);if(existing)return clone(existing);const d={...device,authorized:false,state:"DISCOVERED" as const};devices.push(d);return clone(d)}
export function authorizeDevice(id:string,authorized=true){const d=devices.find(x=>x.id===id);if(!d)throw new Error("device not found");if(d.state==="UNKNOWN"||d.state==="DISCOVERED"||d.state==="IDENTIFIED")d.state=authorized?"AUTHORIZED":"RELEASED";d.authorized=authorized;return clone(d)}
export function allocateDevice(id:string,taskId:string){const d=devices.find(x=>x.id===id);if(!d)throw new Error("device not found");if(!d.authorized||!["AUTHORIZED","AVAILABLE"].includes(d.state))throw new Error("device is not authorized/available");d.state="ALLOCATED";d.currentTaskId=taskId;return clone(d)}
export function releaseDevice(id:string){const d=devices.find(x=>x.id===id);if(!d)throw new Error("device not found");d.state="RELEASED";delete d.currentTaskId;return clone(d)}
