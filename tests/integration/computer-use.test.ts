import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot} from "../helpers/runtime";

isolatedStorageRoot("int-computer-use");

let computers: typeof import("../../lib/computer-use");
let route: typeof import("../../app/api/computer-use/route");

beforeAll(async () => {
  vi.resetModules();
  computers = await import("../../lib/computer-use");
  route = await import("../../app/api/computer-use/route");
});

describe("Computer Use (Discovery ≠ Autorisierung)", () => {
  it("liefert keinen vorautorisierten Computer aus", () => {
    const list = computers.listComputers();
    expect(list.length).toBeGreaterThan(0);
    expect(list.every(instance => instance.authorized === false)).toBe(true);
    expect(list.every(instance => instance.network !== "INTERNET")).toBe(true);
  });

  it("verweigert Allocation ohne Autorisierung und erlaubt sie nach Creator-Freigabe", () => {
    const instance = computers.listComputers()[0];
    expect(() => computers.allocateComputer(instance.id, "TASK-X")).toThrow(/not authorized/);
    const authorized = computers.authorizeComputer(instance.id, true, "CREATOR");
    expect(authorized.authorized).toBe(true);
    const allocated = computers.allocateComputer(instance.id, "TASK-X", "SB-X");
    expect(allocated.state).toBe("ALLOCATED");
    // Start erst nach Allocation, Freigabe setzt den Zustand zurück.
    expect(computers.startComputer(instance.id).state).toBe("EXECUTING");
    const released = computers.releaseComputer(instance.id);
    expect(released.state).toBe("RELEASED");
    expect(released.taskId).toBeUndefined();
    // Autorisierung kann entzogen werden – danach ist keine Allocation mehr möglich.
    computers.authorizeComputer(instance.id, false, "CREATOR");
    expect(() => computers.allocateComputer(instance.id, "TASK-Y")).toThrow(/not authorized/);
  });

  it("verwirft eine Autorisierung, die über die Registrierung mitkommt", () => {
    // Gefundener Fehler: `registerComputer` übernahm `authorized: true` aus dem
    // Aufruf. Ein so autorisierter Computer hatte keinen
    // `computer.authorized`-Nachweis in der Audit-Kette — die Autorisierung war
    // damit nicht nachvollziehbar (Discovery ≠ Autorisierung).
    const registered = computers.registerComputer({
      name: "Direkt autorisiert",
      kind: "CLI",
      os: "linux",
      arch: "x64",
      network: "DENY",
      capabilities: [{kind: "CLI", actions: ["PROCESS_READ"], environments: ["test"], network: "DENY", risk: "LOW"}],
      authorized: true
    });
    expect(registered.authorized).toBe(false);
    expect(() => computers.allocateComputer(registered.id, "TASK-DIRECT")).toThrow(/not authorized/);

    // Autorisierung wirkt ausschließlich über den expliziten Creator-Akt …
    expect(computers.authorizeComputer(registered.id, true, "CREATOR").authorized).toBe(true);
    expect(computers.allocateComputer(registered.id, "TASK-DIRECT").state).toBe("ALLOCATED");
    // … und nur der Creator darf sie erteilen.
    expect(() => computers.authorizeComputer(registered.id, true, "AG-QA")).toThrow(/Creator/);
  });

  it("bindet die Route an Autorisierung (Registrieren/Autorisieren ist Creator-Sache)", async () => {
    const unauthenticated = await route.GET(new Request("http://localhost:3000/api/computer-use"));
    expect([401, 428]).toContain(unauthenticated.status);
  });
});


describe("Device scheduling", () => {
  it("wählt nur autorisierte, verfügbare Geräte und berücksichtigt Ressourcen", async () => {
    const devices = await import("../../lib/devices");
    const first = devices.listDevices()[0];
    if (first.authorized) devices.authorizeDevice(first.id, false, "CREATOR");
    const discovered = devices.discoverDevice({id:"DEV-SCHED-1",name:"Scheduler Test",os:"linux",arch:"x64",cpu:16,ramMb:32768,gpu:"none",network:"NONE",trust:"MANAGED",capabilities:["node","python"],lastSeen:new Date().toISOString()});
    expect(discovered.authorized).toBe(false);
    devices.authorizeDevice(discovered.id,true,"CREATOR");
    const allocated = devices.scheduleDevice("TASK-SCHED",{cpu:8,ramMb:4096,os:"linux",arch:"x64",capabilities:["python"],network:"NONE"});
    expect(allocated.id).toBe(discovered.id);
    expect(allocated.currentTaskId).toBe("TASK-SCHED");
  });

  it("verweigert Scheduling ohne passende autorisierte Kapazität", async () => {
    const devices = await import("../../lib/devices");
    expect(() => devices.scheduleDevice("TASK-NO-GPU",{gpu:"RTX-UNAVAILABLE"})).toThrow(/no authorized device/);
  });
});
