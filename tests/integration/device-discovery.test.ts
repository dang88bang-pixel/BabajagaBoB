import {describe,expect,it} from "vitest";
import {buildMdnsQuery,mergeDiscoveredDevices,readArpTable} from "../../lib/device-discovery";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("Device Discovery",()=>{
 it("liest vorhandene ARP-Nachbarn ohne Autorisierung",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"bob-arp-"));
  const file=path.join(root,"arp");
  fs.writeFileSync(file,"IP address HW type Flags HW address Mask Device\n192.168.1.10 0x1 0x2 AA:BB:CC:DD:EE:FF * eth0\n");
  const rows=readArpTable(file); expect(rows).toHaveLength(1); expect(rows[0].confidence).toBe("OBSERVED");
  fs.rmSync(root,{recursive:true,force:true});
 });
 it("erzeugt eine gültige mDNS-DNS-SD-Query",()=>{const q=buildMdnsQuery();expect(q.readUInt16BE(4)).toBe(1);expect(q.length).toBeGreaterThan(20);});
 it("dedupliziert Geräte ohne Trust-Aufwertung",()=>{
  const merged=mergeDiscoveredDevices(
   [{address:"10.0.0.2",mac:"aa",source:"ARP",observedAt:"2026-01-01T00:00:00Z",confidence:"OBSERVED"}],
   [{address:"10.0.0.2",mac:"aa",source:"MDNS",observedAt:"2026-01-01T00:00:01Z",confidence:"UNVERIFIED"}]
  );
  expect(merged).toHaveLength(1); expect(merged[0].confidence).toBe("OBSERVED");
 });
});
