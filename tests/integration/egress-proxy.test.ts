import http from "node:http";
import net from "node:net";
import type {AddressInfo} from "node:net";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Kontrollierte Egress-Schicht (Phase 4 / 7.1, MASTER §10):
 * Der Proxy vermittelt ausschließlich Allowlist-Ziele über gepinnte Adressen
 * und auditiert jede Entscheidung. Ohne laufenden Proxy bleibt ALLOWLIST
 * fail closed (Vorgabe DENY). Kernel-Isolation ist für diese Suite
 * abgeschaltet, weil der isolierte Netzwerk-Namespace keine Route zum Proxy
 * hätte — dort bleibt ALLOWLIST produktiv fail closed (eigener Nachweis).
 */

process.env.BOB_NS_ISOLATION = "off";
isolatedStorageRoot("egress-proxy");

let allowlist: typeof import("../../lib/egress/allowlist");
let egress: typeof import("../../lib/egress/index");
let dnsPin: typeof import("../../lib/egress/dns-pin");
let audit: typeof import("../../lib/audit");
let fabric: typeof import("../../lib/sandbox/fabric");
let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let verification: typeof import("../../lib/verification");
let runtimeFactory: typeof import("../../lib/runtime-factory");

let origin: http.Server;
let originPort = 0;
const cleanup: Array<() => Promise<void> | void> = [];

function proxyFetch(url: string, proxyUrl: string): Promise<{status: number; body: string}> {
  const target = new URL(url);
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {host: proxy.hostname, port: Number(proxy.port), path: url, method: "GET", headers: {host: target.host}},
      response => {
        let body = "";
        response.on("data", chunk => (body += String(chunk)));
        response.on("end", () => resolve({status: response.statusCode ?? 0, body}));
      }
    );
    request.on("error", reject);
    request.end();
  });
}

function connectViaProxy(authority: string, proxyUrl: string): Promise<{statusLine: string; socket: net.Socket}> {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(proxy.port), proxy.hostname, () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("connect timeout")), 5000);
    socket.on("data", chunk => {
      buffer += String(chunk);
      const head = buffer.split("\r\n")[0];
      if (buffer.includes("\r\n\r\n") || /^HTTP\/1\.[01] \d{3}/.test(head)) {
        clearTimeout(timer);
        resolve({statusLine: head, socket});
      }
    });
    socket.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function makeTask() {
  const mission = cp.createMission({title: "Egress", objective: "Egress-Schicht prüfen", createdBy: "CREATOR"});
  return cp.createTask({missionId: mission.missionId, title: "Egress-Task", risk: "LOW", assignedAgent: "AG-BUILD", createdBy: "CREATOR"});
}

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  verification = await import("../../lib/verification");
  runtimeFactory = await import("../../lib/runtime-factory");
  audit = await import("../../lib/audit");
  allowlist = await import("../../lib/egress/allowlist");
  dnsPin = await import("../../lib/egress/dns-pin");
  egress = await import("../../lib/egress/index");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});

  // Lokaler Ursprung als erlaubtes Ziel (auflösbar über `localhost`).
  origin = http.createServer((request, response) => {
    response.writeHead(200, {"content-type": "text/plain"});
    response.end(`origin-ok:${request.url ?? ""}`);
  });
  await new Promise<void>(resolve => origin.listen(0, "127.0.0.1", () => resolve()));
  originPort = (origin.address() as AddressInfo).port;
  cleanup.push(() => new Promise<void>(resolve => origin.close(() => resolve())));
});

afterAll(async () => {
  await egress.stopEgressProxy().catch(() => undefined);
  for (const step of cleanup.splice(0).reverse()) await step();
});

describe("Egress-Proxy (Allowlist + DNS-Pinning + Audit)", () => {
  it("vermittelt erlaubte Hosts über die gepinnte Adresse", async () => {
    allowlist.addEgressEntry({host: "localhost", ports: [originPort], addedBy: "TEST"});
    const proxy = await egress.ensureEgressProxy();
    expect(proxy.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const result = await proxyFetch(`http://localhost:${originPort}/probe`, proxy.url);
    expect(result.status).toBe(200);
    expect(result.body).toBe("origin-ok:/probe");
    const pin = dnsPin.getDnsPin("localhost");
    expect(pin?.addresses.length ?? 0).toBeGreaterThan(0);
  });

  it("verweigert nicht erlaubte Hosts fail closed und auditiert die Verweigerung", async () => {
    const proxy = await egress.ensureEgressProxy();
    const result = await proxyFetch("http://forbidden.example:80/", proxy.url);
    expect(result.status).toBe(403);
    expect(result.body).toContain("EGRESS_DENIED");
    // Die Kette speichert Argumente als Hash; die Ressource nennt das Ziel.
    const denies = audit.auditSnapshot().filter(record => record.action === "egress:request" && record.decision === "DENY");
    expect(denies.length).toBeGreaterThan(0);
    expect(denies.some(record => record.resource === "forbidden.example:80")).toBe(true);
  });

  it("verweigert erlaubte Hosts auf nicht erlaubten Ports", async () => {
    const proxy = await egress.ensureEgressProxy();
    const otherPort = originPort === 65432 ? 65431 : 65432;
    const result = await proxyFetch(`http://localhost:${otherPort}/`, proxy.url);
    expect(result.status).toBe(403);
  });

  it("CONNECT-Tunnel werden nur zu erlaubten Hosts aufgebaut", async () => {
    const proxy = await egress.ensureEgressProxy();
    const allowed = await connectViaProxy(`localhost:${originPort}`, proxy.url);
    expect(allowed.statusLine).toContain("200");
    allowed.socket.destroy();
    const denied = await connectViaProxy("forbidden.example:443", proxy.url);
    expect(denied.statusLine).toContain("403");
    denied.socket.destroy();
  });

  it("DNS-Pinning legt die Adressmenge fest (kein Rebinding zwischen Prüfung und Verbindung)", async () => {
    const pin = await dnsPin.pinHost("localhost");
    expect(pin.addresses).toContain("127.0.0.1");
    expect(dnsPin.isPinnedAddress("localhost", "127.0.0.1")).toBe(true);
    expect(dnsPin.isPinnedAddress("localhost", "203.0.113.66")).toBe(false);
    const again = await dnsPin.pinHost("localhost");
    expect(again.pinnedAt).toBe(pin.pinnedAt); // gleicher Pin innerhalb der TTL
  });

  it("auditiert erlaubte Vermittlungen als ALLOW", async () => {
    const allows = audit.auditSnapshot().filter(record => record.action === "egress:request" && record.decision === "ALLOW");
    expect(allows.length).toBeGreaterThan(0);
  });
});

describe("ALLOWLIST-Freischaltung in der Sandbox-Fabric", () => {
  it("ALLOWLIST ohne laufenden Proxy bleibt fail closed", async () => {
    await egress.stopEgressProxy();
    const task = await makeTask();
    await expect(
      fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW", network: "ALLOWLIST", allowlist: ["localhost"]})
    ).rejects.toThrow(/egress/);
  });

  it("ALLOWLIST ohne Allowlist-Eintrag bleibt fail closed", async () => {
    await egress.ensureEgressProxy();
    const task = await makeTask();
    await expect(
      fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW", network: "ALLOWLIST", allowlist: ["unlisted.example"]})
    ).rejects.toThrow(/does not cover/);
  });

  it("erlaubt ALLOWLIST mit Proxy; der Sandbox-Prozess erhält die Proxy-Variablen", async () => {
    const proxy = await egress.ensureEgressProxy();
    allowlist.addEgressEntry({host: "localhost", ports: [originPort], addedBy: "TEST"});
    const task = await makeTask();
    const sandbox = await fabric.createSandbox({
      type: "test",
      taskId: task.taskId,
      agentId: "AG-BUILD",
      risk: "LOW",
      network: "ALLOWLIST",
      allowlist: ["localhost"]
    });
    expect(sandbox.network).toBe("ALLOWLIST");
    cleanup.push(() => fabric.destroySandbox(sandbox.sandboxId).catch(() => undefined));
    await fabric.startSandbox(sandbox.sandboxId);
    const smoke = await verification.runSmokeTest(sandbox.sandboxId);
    expect(smoke.accepted, JSON.stringify(smoke)).toBe(true);
    // Ausführung auf Runtime-Ebene: Der Sandbox-Prozess muss die Proxy-Variablen
    // erhalten (Produktivweg ist der Broker; hier zählt die Env-Durchreichung).
    // argv-Policy: keine Shell-Metazeichen (`$`, `|` u. a.) — daher reine
    // String-Verkettung ohne Template oder Sonderzeichen.
    const execution = await runtimeFactory.activeSandboxRuntime.execute(sandbox.sandboxId, [
      "node",
      "-e",
      'process.stdout.write((process.env.HTTP_PROXY ?? "none") + "," + (process.env.HTTPS_PROXY ?? "none"))'
    ]);
    expect(execution.accepted, execution.stderr || execution.message).toBe(true);
    expect(execution.stdout).toBe(`${proxy.url},${proxy.url}`);
  }, 30_000);
});
