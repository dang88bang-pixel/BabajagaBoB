import http from "node:http";
import net from "node:net";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {isolatedStorageRoot} from "../helpers/runtime";

/**
 * Kontrollierter Ausgangsverkehr (ALLOWLIST).
 *
 * Der Nachweis hat zwei Hälften:
 *  1. **Fail closed**: ohne Allowlist, bei nicht freigegebenem Ziel, bei
 *     privater Adresse und bei abweichender Auflösung wird verweigert.
 *  2. **Wirksam**: ein freigegebenes Ziel wird aufgelöst, gepinnt und wirklich
 *     verbunden — nicht nur „erlaubt" protokolliert.
 *
 * Die Umgebung hat keinen freien Internetzugang. Deshalb wird der Tunnel hier
 * gegen einen **lokalen** Zielserver über `connectPinned` nachgewiesen (der
 * Proxy verbindet immer zu einer Adresse, nie zu einem Namen), und der
 * HTTP-Weg wird bis zur Entscheidung des Proxys geprüft (403 verweigert,
 * sonst Aufbau oder 502 bei blockiertem Ausgang — beides auditiert).
 */

const root = isolatedStorageRoot("egress-proxy");
void root;

let egress: typeof import("../../lib/egress-proxy");
let audit: typeof import("../../lib/audit");

beforeEach(async () => {
  process.env.BOB_STORAGE_DIR = root;
  const modules = await Promise.all([import("../../lib/egress-proxy"), import("../../lib/audit")]);
  egress = modules[0];
  audit = modules[1];
  delete process.env.BOB_EGRESS_ALLOWLIST;
});

afterEach(async () => {
  await egress.stopEgressProxy();
  delete process.env.BOB_EGRESS_ALLOWLIST;
});

describe("Allowlist-Auswertung", () => {
  it("ist ohne Konfiguration leer und damit fail closed", () => {
    expect(egress.egressRules()).toEqual([]);
    expect(egress.egressAvailable()).toBe(false);
    const verdict = egress.isAllowed({host: "example.com", port: 443});
    expect(verdict.allowed).toBe(false);
    expect(egress.egressStatus().reason).toMatch(/fail closed/);
  });

  it("übernimmt nur wohlgeformte Einträge", () => {
    process.env.BOB_EGRESS_ALLOWLIST = "registry.npmjs.org:443, example.com:443 , kaputt, nur-host, :443, host:99999";
    const rules = egress.egressRules();
    expect(rules).toEqual([
      {host: "registry.npmjs.org", port: 443},
      {host: "example.com", port: 443}
    ]);
  });

  it("erlaubt nur exakte host:port-Paare", () => {
    process.env.BOB_EGRESS_ALLOWLIST = "example.com:443";
    expect(egress.isAllowed({host: "example.com", port: 443}).allowed).toBe(true);
    expect(egress.isAllowed({host: "example.com", port: 80}).allowed).toBe(false);
    expect(egress.isAllowed({host: "www.example.com", port: 443}).allowed).toBe(false);
    expect(egress.isAllowed({host: "EXAMPLE.com", port: 443}).allowed).toBe(true);
    expect(egress.isAllowed({host: "", port: 443}).allowed).toBe(false);
  });
});

describe("Adressgrenzen", () => {
  it("schließt private, link-lokale und reservierte Bereiche aus", () => {
    for (const address of ["10.0.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "172.31.255.255", "192.168.0.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1"]) {
      expect(egress.isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ["8.8.8.8", "104.20.23.154", "172.15.0.1", "172.32.0.1", "100.63.0.1"]) {
      expect(egress.isPrivateAddress(address), address).toBe(false);
    }
    // Unlesbare Eingaben sind privat (fail closed), nicht „öffentlich".
    expect(egress.isPrivateAddress("keine-adresse")).toBe(true);
  });

  it("pinnt nur öffentliche Adressen und liefert einen stabilen Digest", async () => {
    const localhost = await egress.resolvePinned("localhost");
    expect(localhost.addresses).toEqual([]);
    expect(localhost.reason).toMatch(/erlaubte öffentliche Adresse|fehlgeschlagen/);

    const resolved = await egress.resolvePinned("example.com");
    if (resolved.addresses.length === 0) {
      // Ohne Namensdienst ist das ein Zustand, kein Erfolg — und wird begründet.
      expect(resolved.reason).toBeTruthy();
      return;
    }
    expect(resolved.addresses.every(address => !egress.isPrivateAddress(address))).toBe(true);
    expect(resolved.digest).toMatch(/^[a-f0-9]{64}$/);
    const again = await egress.resolvePinned("example.com");
    expect(again.digest).toBe(resolved.digest);
  });
});

describe("Verbindung nur zu gepinnten Adressen", () => {
  it("verbindet zu einer Adresse aus der gepinnten Menge", async () => {
    const target = net.createServer(socket => socket.end("ok\n"));
    await new Promise<void>(resolve => target.listen(0, "127.0.0.1", resolve));
    const address = target.address() as net.AddressInfo;
    try {
      const socket = await egress.connectPinned("localhost", address.port, ["127.0.0.1"]);
      expect(socket.remoteAddress).toBe("127.0.0.1");
      const payload = await new Promise<string>(resolve => {
        let data = "";
        socket.on("data", chunk => (data += String(chunk)));
        socket.on("end", () => resolve(data));
      });
      expect(payload).toContain("ok");
      socket.destroy();
    } finally {
      await new Promise<void>(resolve => target.close(() => resolve()));
    }
  });

  it("verweigert ohne gepinnte Adresse", async () => {
    await expect(egress.connectPinned("localhost", 1, [])).rejects.toThrow(/gepinnte Adresse/);
  });
});

describe("Proxy-Entscheidungen", () => {
  it("verweigert ein nicht freigegebenes Ziel mit 403", async () => {
    process.env.BOB_EGRESS_ALLOWLIST = "example.com:443";
    const {port} = await egress.startEgressProxy({port: 0});

    const status = await new Promise<number>(resolve => {
      const request = http.request({host: "127.0.0.1", port, method: "CONNECT", path: "blocked.example:443"});
      request.on("connect", response => {
        resolve(response.statusCode ?? 0);
        request.destroy();
      });
      request.on("error", () => resolve(0));
      request.end();
    });

    expect(status).toBe(403);
    const denied = audit.auditSnapshot(200).filter(entry => entry.action === "egress.connect" && entry.decision === "DENY");
    expect(denied.length).toBeGreaterThan(0);
  });

  it("lässt ein freigegebenes Ziel passieren (Aufbau oder blockierter Ausgang)", async () => {
    process.env.BOB_EGRESS_ALLOWLIST = "example.com:443";
    const {port} = await egress.startEgressProxy({port: 0});

    const status = await new Promise<number>(resolve => {
      const request = http.request({host: "127.0.0.1", port, method: "CONNECT", path: "example.com:443"});
      request.on("connect", response => {
        resolve(response.statusCode ?? 0);
        request.destroy();
      });
      request.on("error", () => resolve(0));
      request.end();
    });

    // 200 = Tunnel steht, 502 = Ziel war nicht erreichbar (diese Umgebung hat
    // keinen Ausgang). Beides heißt: die Allowlist-Prüfung war bestanden —
    // ein 403 wäre die Verweigerung und damit ein Fehler.
    expect([200, 502]).toContain(status);
    const records = audit.auditSnapshot(200).filter(entry => entry.action === "egress.connect");
    expect(records.length).toBeGreaterThan(0);
  });

  it("verweigert einfache Proxy-Anfragen (kein offener Proxy)", async () => {
    process.env.BOB_EGRESS_ALLOWLIST = "example.com:443";
    const {port} = await egress.startEgressProxy({port: 0});
    const response = await fetch(`http://127.0.0.1:${port}/http://example.com/`);
    expect(response.status).toBe(403);
  });

  it("verweigert alles, wenn keine Allowlist konfiguriert ist — obwohl er läuft", async () => {
    const {port} = await egress.startEgressProxy({port: 0});
    expect(egress.egressStatus().running).toBe(true);
    expect(egress.egressStatus().configured).toBe(false);

    const status = await new Promise<number>(resolve => {
      const request = http.request({host: "127.0.0.1", port, method: "CONNECT", path: "example.com:443"});
      request.on("connect", response => {
        resolve(response.statusCode ?? 0);
        request.destroy();
      });
      request.on("error", () => resolve(0));
      request.end();
    });
    expect(status).toBe(403);
  });

  it("hält die Audit-Kette über alle Entscheidungen integer", () => {
    expect(audit.verifyAuditChain().valid).toBe(true);
  });
});
