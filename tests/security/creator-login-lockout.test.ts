import fs from "node:fs";
import path from "node:path";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

const root = isolatedStorageRoot("sec-creator-lockout");

let authRoute: typeof import("../../app/api/auth/route");
let creatorAuth: typeof import("../../lib/creator-auth");
let audit: typeof import("../../lib/audit");

const AUTH_URL = "http://localhost/api/auth";

function post(body: unknown): Request {
  return new Request(AUTH_URL, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(body)
  });
}

beforeAll(async () => {
  vi.resetModules();
  authRoute = await import("../../app/api/auth/route");
  creatorAuth = await import("../../lib/creator-auth");
  audit = await import("../../lib/audit");
  await authRoute.POST(post({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"}));
});

describe("Creator-Anmeldung: Sperre gegen Brute Force", () => {
  it("sperrt den Anmeldeweg nach fünf Fehlversuchen (423) — auch für das korrekte Secret", async () => {
    const secret = fs.readFileSync(path.join(root, "creator-token"), "utf8").trim();

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await authRoute.POST(post({action: "login", secret: `falsch-${attempt}`}));
      expect(response.status).toBe(403);
    }
    expect(creatorAuth.creatorLockState().locked).toBe(false);

    const fifth = await authRoute.POST(post({action: "login", secret: "falsch-5"}));
    expect(fifth.status).toBe(423);
    expect(((await fifth.json()) as {error: string}).error).toBe("CREATOR_LOCKED");

    // Während der Sperre wird auch das korrekte Secret abgewiesen.
    const correct = await authRoute.POST(post({action: "login", secret}));
    expect(correct.status).toBe(423);
    expect(creatorAuth.creatorLockState().locked).toBe(true);

    // Der Status meldet die Sperre, ohne Details oder Secrets preiszugeben.
    const status = (await (await authRoute.GET(new Request(AUTH_URL))).json()) as {locked: boolean; authenticated: boolean};
    expect(status.locked).toBe(true);
    expect(status.authenticated).toBe(false);

    const denials = audit.auditSnapshot(200).filter(record => record.action === "creator.login" && record.decision === "DENY");
    expect(denials.length).toBeGreaterThanOrEqual(5);
    expect(audit.verifyAuditChain().valid).toBe(true);
  });
});
