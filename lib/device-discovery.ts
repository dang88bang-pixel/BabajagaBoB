import fs from "node:fs";
import dgram from "node:dgram";

export type DiscoveredDevice={address:string;mac?:string;source:"ARP"|"MDNS";hostname?:string;observedAt:string;confidence:"OBSERVED"|"UNVERIFIED"};

function validIpv4(value:string):boolean{
 const p=value.split(".").map(Number); return p.length===4&&p.every(n=>Number.isInteger(n)&&n>=0&&n<=255);
}

/** Liest ausschließlich bereits vom Kernel bekannte Nachbarn; kein aktives Scanning. */
export function readArpTable(procPath="/proc/net/arp"):DiscoveredDevice[]{
 if(!fs.existsSync(procPath)) return [];
 const lines=fs.readFileSync(procPath,"utf8").split(/\r?\n/).slice(1);
 const observedAt=new Date().toISOString();
 return lines.map(line=>line.trim().split(/\s+/)).filter(parts=>parts.length>=4&&validIpv4(parts[0])&&parts[3]!=="00:00:00:00:00:00")
   .map(parts=>({address:parts[0],mac:parts[3].toLowerCase(),source:"ARP" as const,observedAt,confidence:"OBSERVED" as const}));
}

/** Erstellt eine minimale mDNS-Query. Ergebnisdaten werden nur als Discovery, nie als Autorisierung behandelt. */
export function buildMdnsQuery(name="_services._dns-sd._udp.local"):Buffer{
 const labels=name.split(".");
 const header=Buffer.alloc(12); header.writeUInt16BE(0,0); header.writeUInt16BE(0,2); header.writeUInt16BE(1,4);
 const body=Buffer.concat([Buffer.from(labels.flatMap(label=>[label.length,...Buffer.from(label)])),Buffer.from([0]),Buffer.from([0,12,0,1])]);
 return Buffer.concat([header,body]);
}

/** Aktive mDNS-Discovery ist bewusst separat und zeitlich begrenzt. */
export async function discoverMdns(options:{timeoutMs?:number;name?:string;port?:number}={}):Promise<DiscoveredDevice[]>{
 const timeout=Math.min(5000,Math.max(100,Math.trunc(options.timeoutMs??1000)));
 const socket=dgram.createSocket("udp4");
 const results:DiscoveredDevice[]=[]; const observedAt=new Date().toISOString();
 return await new Promise((resolve,reject)=>{
  let settled=false;
  const finish=()=>{if(settled)return;settled=true;try{socket.close()}catch{};resolve(results)};
  socket.on("error",error=>{if(settled)return;settled=true;try{socket.close()}catch{};reject(error)});
  socket.on("message",(message,remote)=>{
   const hostname=message.includes(Buffer.from("local"))?"mDNS service advertisement":undefined;
   if(remote.address)results.push({address:remote.address,hostname,source:"MDNS",observedAt,confidence:"UNVERIFIED"});
  });
  socket.bind(0,"0.0.0.0",()=>{
   socket.setBroadcast(true);
   const query=buildMdnsQuery(options.name);
   socket.send(query,0,query.length,options.port??5353,"224.0.0.251");
  });
  setTimeout(finish,timeout).unref();
 });
}

/**
 * Discovery-Ergebnis wird absichtlich nicht automatisch autorisiert.
 * Autorisierung bleibt beim Creator/Authority-System.
 */
export function mergeDiscoveredDevices(...lists:DiscoveredDevice[]):DiscoveredDevice[]{
 const map=new Map<string,DiscoveredDevice>();
 for(const device of lists.flat()){
  const key=device.mac?device.mac:device.address;
  const previous=map.get(key);
  map.set(key,previous?{...previous,hostname:previous.hostname??device.hostname,confidence:previous.confidence==="OBSERVED"?"OBSERVED":device.confidence}:device);
 }
 return [...map.values()].sort((a,b)=>a.address.localeCompare(b.address));
}
