import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Creator Inbox (Abschnitt 33) — Regressionstest für zwei reale Fehler:
 *
 *  1. `POST {action:"resolve"}` war unerreichbar (stand hinter einem `return`):
 *     jede Anfrage legte stattdessen einen neuen Eintrag an, Antworten waren
 *     unmöglich.
 *  2. `GET /api/inbox` lieferte 500, weil der Store durch den Backup-Pfad als
 *     inhaltsloser Envelope (`payload: null`) angelegt worden war.
 */

isolatedStorageRoot("sec-inbox");

let authRoute: typeof import("../../app/api/auth/route");
let inboxRoute: typeof import("../../app/api/inbox/route");
let inbox: typeof import("../../lib/inbox");

const BASE = "http://localhost:3000";
let cookie = "";

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: {"content-type": "application/json", ...headers},
    body: JSON.stringify(body)
  });
}

beforeAll(async () => {
  vi.resetModules();
  authRoute = await import("../../app/api/auth/route");
  inboxRoute = await import("../../app/api/inbox/route");
  inbox = await import("../../lib/inbox");
  const response = await authRoute.POST(jsonRequest("/api/auth", {action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Inbox-Tester"}));
  expect(response.status).toBe(201);
  cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
});

describe("Creator Inbox", () => {
  it("legt einen Eintrag an und listet ihn", async () => {
    const created = await inboxRoute.POST(
      jsonRequest("/api/inbox", {action: "notify", item: {mode: "INFORM", title: "Statusbericht", message: "Alles im Plan"}}, {cookie})
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as {item: {inboxId: string; mode: string; resolved: boolean}};
    expect(body.item.mode).toBe("INFORM");
    expect(body.item.resolved).toBe(false);

    const list = await inboxRoute.GET(new Request(`${BASE}/api/inbox`, {headers: {cookie}}));
    expect(list.status).toBe(200);
    const items = ((await list.json()) as {items: {inboxId: string}[]}).items;
    expect(items.some(item => item.inboxId === body.item.inboxId)).toBe(true);
  });

  it("beantwortet einen Eintrag wirklich (statt einen neuen anzulegen)", async () => {
    const created = await inboxRoute.POST(
      jsonRequest("/api/inbox", {action: "notify", item: {mode: "ASK", title: "Freigabe?", message: "Deployment vorbereiten?"}}, {cookie})
    );
    const id = ((await created.json()) as {item: {inboxId: string}}).item.inboxId;
    const before = inbox.listInbox().length;

    const resolved = await inboxRoute.POST(jsonRequest("/api/inbox", {action: "resolve", id, decision: "APPROVED"}, {cookie}));
    expect(resolved.status).toBe(200);
    const body = (await resolved.json()) as {item: {resolved: boolean; resolvedBy: string; decision: string}};
    expect(body.item.resolved).toBe(true);
    expect(body.item.resolvedBy).toBe("CREATOR");
    expect(body.item.decision).toBe("APPROVED");

    // Kein Nebeneffekt: die Anzahl der Einträge bleibt gleich.
    expect(inbox.listInbox()).toHaveLength(before);

    // Doppelte Beantwortung wird abgelehnt.
    const again = await inboxRoute.POST(jsonRequest("/api/inbox", {action: "resolve", id}, {cookie}));
    expect(again.status).toBe(400);
  });

  it("verweigert unbekannte Aktionen und unvollständige Einträge", async () => {
    const unknown = await inboxRoute.POST(jsonRequest("/api/inbox", {action: "loeschen"}, {cookie}));
    expect(unknown.status).toBe(400);
    const bad = await inboxRoute.POST(jsonRequest("/api/inbox", {action: "notify", item: {mode: "INFORM"}}, {cookie}));
    expect(bad.status).toBe(400);
    const wrongMode = await inboxRoute.POST(
      jsonRequest("/api/inbox", {action: "notify", item: {mode: "DRINGEND", title: "x", message: "y"}}, {cookie})
    );
    expect(wrongMode.status).toBe(400);
  });

  it("verweigert den Zugriff ohne Session", async () => {
    const list = await inboxRoute.GET(new Request(`${BASE}/api/inbox`));
    expect([401, 428]).toContain(list.status);
  });
});
