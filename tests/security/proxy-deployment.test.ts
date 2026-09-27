import {afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Betrieb hinter einem Reverse Proxy / in einer eingebetteten Vorschau.
 *
 * Belegt wird **nicht**, dass die Plattform „irgendwie auch ohne Proxy"
 * funktioniert, sondern dass beide Richtungen explizit und fail closed sind:
 *
 *   1. Ohne `BOB_TRUST_PROXY=1` werden weitergeleitete Header ignoriert: ein
 *      fremder `X-Forwarded-Host` darf die CSRF-Prüfung **nicht** aufweichen.
 *   2. Mit `BOB_TRUST_PROXY=1` gilt der öffentliche Host: Mutationen über den
 *      Proxy werden zugelassen, ein abweichender `Origin` bleibt verboten.
 *   3. `BOB_COOKIE_SAMESITE` steuert das Session-Cookie; unbekannte Werte fallen
 *      fail closed auf `Strict` zurück, `None` erzwingt `Secure`.
 */
isolatedStorageRoot("sec-proxy-deployment");

type Guard = typeof import("../../lib/api/guard");
type ProxyModule = typeof import("../../lib/api/proxy");

const API_URL = "http://localhost/api/control";
const AUTH_URL = "http://localhost/api/auth";

let guard: Guard;
let proxy: ProxyModule;
let session: typeof import("../../lib/session");
let authRoute: typeof import("../../app/api/auth/route");

const ENV_KEYS = ["BOB_TRUST_PROXY", "BOB_COOKIE_SAMESITE", "BOB_COOKIE_SECURE"] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  vi.resetModules();
  proxy = await import("../../lib/api/proxy");
  guard = await import("../../lib/api/guard");
  session = await import("../../lib/session");
  authRoute = await import("../../app/api/auth/route");
  // Der Routen-Guard ist vor dem Bootstrap fail closed (428) — für die
  // CSRF-/Cookie-Fälle muss die Plattform initialisiert sein.
  const bootstrap = await import("../../lib/bootstrap");
  try {
    bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    if (!/ALREADY_INITIALIZED|initialized/i.test(code)) throw error;
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

/** Erzeugt eine Session und gibt den fertigen Cookie-Kopf zurück. */
function sessionCookie(): string {
  const {token} = session.createSession({actorId: "CREATOR", role: "OWNER"});
  return `${session.SESSION_COOKIE}=${token}`;
}

function mutation(origin: string, headers: Record<string, string> = {}): Request {
  return new Request(API_URL, {method: "POST", headers: {origin, "content-type": "application/json", ...headers}});
}

/** Prüft, dass der Routen-Guard mit einem bestimmten Code verweigert. */
function expectDenied(request: Request, action: string, code: string) {
  let thrown: unknown = null;
  try {
    guard.guardRequest(request, {action});
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `Verweigerung mit ${code} erwartet`).toBeInstanceOf(guard.ApiDenied);
  expect((thrown as {code?: string}).code).toBe(code);
}

describe("Reverse-Proxy-Header", () => {
  it("liest X-Forwarded-Host nur bei aktivem Vertrauen (Standard: fail closed)", () => {
    delete process.env.BOB_TRUST_PROXY;
    const request = new Request(API_URL, {headers: {host: "localhost", "x-forwarded-host": "public.example"}});
    expect(proxy.effectiveHost(request)).toBe("localhost");
    expect(proxy.trustProxyEnabled()).toBe(false);

    process.env.BOB_TRUST_PROXY = "1";
    expect(proxy.trustProxyEnabled()).toBe(true);
    expect(proxy.effectiveHost(request)).toBe("public.example");
  });

  it("wertet bei mehreren Proxies den äußersten Eintrag aus", () => {
    process.env.BOB_TRUST_PROXY = "1";
    const request = new Request(API_URL, {headers: {host: "localhost", "x-forwarded-host": "public.example, internal:3000"}});
    expect(proxy.effectiveHost(request)).toBe("public.example");
  });

  it("erkennt HTTPS aus X-Forwarded-Proto (auch mit Proxy-Kette)", () => {
    process.env.BOB_TRUST_PROXY = "1";
    expect(proxy.isForwardedHttps(new Request(API_URL, {headers: {"x-forwarded-proto": "https, http"}}))).toBe(true);
    expect(proxy.isForwardedHttps(new Request(API_URL, {headers: {"x-forwarded-proto": "http"}}))).toBe(false);
  });

  it("lässt ohne Freigabe keine Mutation über einen fremden Proxy-Host zu", () => {
    delete process.env.BOB_TRUST_PROXY;
    const request = mutation("https://public.example", {host: "localhost", "x-forwarded-host": "public.example", cookie: sessionCookie()});
    expectDenied(request, "control:read", "CSRF_ORIGIN");
  });

  it("erlaubt mit Freigabe Mutationen über den öffentlichen Host und wehrt fremde Ursprünge weiter ab", () => {
    process.env.BOB_TRUST_PROXY = "1";
    const cookie = sessionCookie();
    const own = mutation("https://public.example", {host: "localhost", "x-forwarded-host": "public.example", cookie});
    const {actor} = guard.guardRequest(own, {action: "control:read"});
    expect(actor.actorId).toBe("CREATOR");

    const foreign = mutation("https://evil.example", {host: "localhost", "x-forwarded-host": "public.example", cookie});
    expectDenied(foreign, "control:read", "CSRF_ORIGIN");
  });
});

describe("Session-Cookie im Deployment", () => {
  /**
   * Cookie-Attribute über die echte Route (kein Nachbau der Formatierung):
   * eine kurzlebige Session wird erneuert, dabei setzt die Route das Cookie.
   */
  async function renewedCookie(): Promise<string> {
    const issued = session.createSession({actorId: "CREATOR", role: "OWNER", ttlMs: 60_000});
    const response = await authRoute.POST(
      new Request(AUTH_URL, {
        method: "POST",
        headers: {"content-type": "application/json", cookie: `${session.SESSION_COOKIE}=${issued.token}`},
        body: JSON.stringify({action: "renew"})
      })
    );
    expect(response.status, await response.text()).toBe(200);
    return response.headers.get("set-cookie") ?? "";
  }

  it("nutzt standardmäßig SameSite=Strict", async () => {
    delete process.env.BOB_COOKIE_SAMESITE;
    const cookie = await renewedCookie();
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("HttpOnly");
  });

  it("fällt bei unbekanntem Wert fail closed auf Strict zurück", async () => {
    process.env.BOB_COOKIE_SAMESITE = "irgendwas";
    expect(await renewedCookie()).toContain("SameSite=Strict");
  });

  it("setzt SameSite=None ausschließlich mit Secure (sonst verwirft der Browser das Cookie)", async () => {
    process.env.BOB_COOKIE_SAMESITE = "none";
    delete process.env.BOB_COOKIE_SECURE;
    const cookie = await renewedCookie();
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain("Secure");
  });

  it("erlaubt Lax für Top-Level-Navigation hinter einem Proxy", async () => {
    process.env.BOB_COOKIE_SAMESITE = "lax";
    process.env.BOB_COOKIE_SECURE = "1";
    const cookie = await renewedCookie();
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
  });
});
