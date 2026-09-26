import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

isolatedStorageRoot("sec-api-gate");

let gate: typeof import("../../lib/api/api-gate");
let authRoute: typeof import("../../app/api/auth/route");
let session: typeof import("../../lib/session");
let audit: typeof import("../../lib/audit");

const AUTH_URL = "http://localhost/api/auth";
const API_URL = "http://localhost/api/control";

function post(body: unknown, cookie?: string): Request {
  return new Request(AUTH_URL, {
    method: "POST",
    headers: {"content-type": "application/json", ...(cookie ? {cookie} : {})},
    body: JSON.stringify(body)
  });
}

function setCookie(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0];
}

beforeAll(async () => {
  vi.resetModules();
  gate = await import("../../lib/api/api-gate");
  authRoute = await import("../../app/api/auth/route");
  session = await import("../../lib/session");
  audit = await import("../../lib/audit");
});

describe("API-Gate (Server-Authentifizierung der Oberfläche)", () => {
  it("antwortet vor dem Bootstrap auf API-Aufrufe mit 428 (fail closed)", () => {
    const decision = gate.apiGateDecision(new Request(API_URL));
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.status).toBe(428);
  });

  it("lässt die Authentifizierungsstrecke selbst zu", () => {
    expect(gate.apiGateDecision(new Request(AUTH_URL)).allow).toBe(true);
    expect(gate.apiGateDecision(new Request(`${AUTH_URL}?x=1`)).allow).toBe(true);
  });

  it("verweigert falsche Bootstrap-Secrets (403) und auditiert die Ablehnung", async () => {
    const response = await authRoute.POST(post({action: "bootstrap", secret: "falsch", creatorName: "Angreifer"}));
    expect(response.status).toBe(403);
    expect(audit.auditSnapshot(200).some(record => record.decision === "DENY")).toBe(true);
  });

  it("stellt nach korrektem Bootstrap eine HttpOnly-Session aus", async () => {
    const response = await authRoute.POST(post({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"}));
    expect(response.status).toBe(201);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${session.SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    // Der Browser erhält kein Secret außer der Session-ID selbst.
    const body = (await response.json()) as {rootAuthorityId?: string; session?: {actorId: string}};
    expect(body.session?.actorId).toBe("CREATOR");
    expect(JSON.stringify(body)).not.toContain(TEST_BOOTSTRAP_SECRET);

    const status = (await (await authRoute.GET(new Request(AUTH_URL, {headers: {cookie: setCookie(response)}}))).json()) as {
      authenticated: boolean;
      actor: {role: string} | null;
    };
    expect(status.authenticated).toBe(true);
    expect(status.actor?.role).toBe("OWNER");

    // Zweiter Bootstrap ist verboten.
    const second = await authRoute.POST(post({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Zweiter"}));
    expect([400, 409, 423]).toContain(second.status);
  });

  it("verweigert API-Aufrufe ohne Session (401) und erlaubt sie mit Session", () => {
    expect(gate.apiGateDecision(new Request(API_URL)).allow).toBe(false);
    const {token} = session.createSession({actorId: "CREATOR", role: "OWNER"});
    const decision = gate.apiGateDecision(new Request(API_URL, {headers: {cookie: `${session.SESSION_COOKIE}=${token}`}}));
    expect(decision.allow).toBe(true);
  });

  it("akzeptiert weder Agent-Token noch Legacy-Token an der API-Grenze", () => {
    const agent = gate.apiGateDecision(
      new Request(API_URL, {headers: {authorization: "Bobcap CAP-TEST.secret"}})
    );
    expect(agent.allow).toBe(false);
    if (!agent.allow) expect(agent.status).toBe(401);

    process.env.BOB_CONTROL_PLANE_TOKEN = "legacy-token";
    process.env.BOB_ALLOW_LEGACY_CONTROL_TOKEN = "1";
    const legacy = gate.apiGateDecision(new Request(API_URL, {headers: {authorization: "Bearer legacy-token"}}));
    expect(legacy.allow).toBe(false);
    delete process.env.BOB_CONTROL_PLANE_TOKEN;
    delete process.env.BOB_ALLOW_LEGACY_CONTROL_TOKEN;
  });

  it("blockiert Cross-Origin-Mutationen auch mit gültiger Session (CSRF)", () => {
    const {token} = session.createSession({actorId: "CREATOR", role: "OWNER"});
    const decision = gate.apiGateDecision(
      new Request(API_URL, {
        method: "POST",
        headers: {host: "localhost", origin: "https://evil.example", cookie: `${session.SESSION_COOKIE}=${token}`}
      })
    );
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.status).toBe(403);
  });

  it("verlängert und beendet Sessions kontrolliert", async () => {
    const issued = session.createSession({actorId: "CREATOR", role: "OWNER", ttlMs: 60_000});
    const cookie = `${session.SESSION_COOKIE}=${issued.token}`;

    const renewed = await authRoute.POST(post({action: "renew"}, cookie));
    expect(renewed.status).toBe(200);
    const newCookie = setCookie(renewed);
    expect(newCookie).toContain(session.SESSION_COOKIE);
    expect(session.resolveSession(cookie.split("=")[1])).toBeNull();

    const logout = await authRoute.POST(post({action: "logout"}, newCookie));
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(session.resolveSession(newCookie.split("=")[1])).toBeNull();
  });
});
