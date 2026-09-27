import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot} from "../helpers/runtime";

isolatedStorageRoot("egress-allowlist");

let allowlist: typeof import("../../lib/egress/allowlist");

beforeAll(async () => {
  vi.resetModules();
  allowlist = await import("../../lib/egress/allowlist");
});

describe("Egress-Allowlist (Vorgabe DENY)", () => {
  it("validiert Hostnamen und lehnt IP-Literale ab", () => {
    expect(allowlist.isValidEgressHost("example.com")).toBe(true);
    expect(allowlist.isValidEgressHost("*.example.com")).toBe(true);
    expect(allowlist.isValidEgressHost("registry.internal-host.de")).toBe(true);
    expect(allowlist.isValidEgressHost("127.0.0.1")).toBe(false);
    expect(allowlist.isValidEgressHost("::1")).toBe(false);
    expect(allowlist.isValidEgressHost("localhost")).toBe(true); // einzelnes Label ist ein gültiger Hostname
    expect(allowlist.isValidEgressHost("")).toBe(false);
    expect(allowlist.isValidEgressHost("*.")).toBe(false);
    expect(allowlist.isValidEgressHost("example.*")).toBe(false);
  });

  it("normiert Eingaben (Schema, Port, Trailing-Dot, Großschreibung)", () => {
    expect(allowlist.normalizeEgressHost("https://Example.COM:8443/path")).toBe("example.com");
    expect(allowlist.normalizeEgressHost("Example.Com.")).toBe("example.com");
  });

  it("verweigert ungültige Einträge fail closed", () => {
    expect(() => allowlist.addEgressEntry({host: "10.0.0.1", addedBy: "TEST"})).toThrow(/hostname required/);
    expect(() => allowlist.addEgressEntry({host: "example.com", ports: [0], addedBy: "TEST"})).toThrow(/port/);
    expect(() => allowlist.addEgressEntry({host: "example.com", ports: [70000], addedBy: "TEST"})).toThrow(/port/);
  });

  it("legt Einträge mit Standardports an und führt Ports zusammen", () => {
    const entry = allowlist.addEgressEntry({host: "Example.com:443", addedBy: "CREATOR", reason: "Test"});
    expect(entry.host).toBe("example.com");
    expect(entry.ports).toEqual([80, 443]);
    const merged = allowlist.addEgressEntry({host: "example.com", ports: [8443], addedBy: "CREATOR"});
    expect(merged.ports.sort((a, b) => a - b)).toEqual([80, 443, 8443]);
    expect(allowlist.listEgressEntries().filter(e => e.host === "example.com")).toHaveLength(1);
  });

  it("lässt nur Hosts und Ports der Allowlist zu", () => {
    allowlist.addEgressEntry({host: "allowed.example", ports: [443], addedBy: "CREATOR"});
    expect(allowlist.egressAllows("allowed.example", 443).allowed).toBe(true);
    expect(allowlist.egressAllows("ALLOWED.example", 443).allowed).toBe(true);
    expect(allowlist.egressAllows("allowed.example", 80).allowed).toBe(false);
    expect(allowlist.egressAllows("other.example", 443).allowed).toBe(false);
  });

  it("Wildcards decken Subdomains ab, niemals die Basisdomain selbst", () => {
    allowlist.addEgressEntry({host: "*.cdn.example", ports: [443], addedBy: "CREATOR"});
    expect(allowlist.egressAllows("a.cdn.example", 443).allowed).toBe(true);
    expect(allowlist.egressAllows("deep.a.cdn.example", 443).allowed).toBe(true);
    expect(allowlist.egressAllows("cdn.example", 443).allowed).toBe(false);
    expect(allowlist.egressAllows("evilcdn.example", 443).allowed).toBe(false);
  });

  it("Entfernen macht den Host sofort wieder fail closed", () => {
    allowlist.addEgressEntry({host: "temp.example", addedBy: "CREATOR"});
    expect(allowlist.egressAllows("temp.example", 443).allowed).toBe(true);
    expect(allowlist.removeEgressEntry("temp.example")).toBe(true);
    expect(allowlist.egressAllows("temp.example", 443).allowed).toBe(false);
    expect(allowlist.removeEgressEntry("temp.example")).toBe(false);
  });
});
