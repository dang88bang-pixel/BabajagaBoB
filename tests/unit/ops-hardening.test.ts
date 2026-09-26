import {afterEach, describe, expect, it} from "vitest";
import {consumeRateLimit, rateLimitResetForTests} from "../../lib/api/rate-limit";
import {beginShutdown, isShuttingDown, shutdownStatus} from "../../lib/shutdown";

describe("Betriebshärtung", () => {
  afterEach(() => {
    rateLimitResetForTests();
    delete process.env.BOB_RATE_LIMIT_MAX;
    delete process.env.BOB_RATE_LIMIT_WINDOW_MS;
    delete process.env.BOB_AUTH_RATE_LIMIT_MAX;
    delete process.env.BOB_SHUTTING_DOWN;
  });

  it("begrenzt API-Anfragen und liefert einen Retry-Zeitraum", () => {
    process.env.BOB_RATE_LIMIT_MAX = "2";
    process.env.BOB_RATE_LIMIT_WINDOW_MS = "60000";
    const request = new Request("http://localhost/api/control", {headers: {"user-agent":"ops-test"}});
    expect(consumeRateLimit(request, "api").allowed).toBe(true);
    expect(consumeRateLimit(request, "api").allowed).toBe(true);
    const denied = consumeRateLimit(request, "api");
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("trennt Authentifizierungs-Limit vom normalen API-Limit", () => {
    process.env.BOB_RATE_LIMIT_MAX = "100";
    process.env.BOB_AUTH_RATE_LIMIT_MAX = "1";
    const request = new Request("http://localhost/api/auth", {headers: {"user-agent":"auth-test"}});
    expect(consumeRateLimit(request, "auth").allowed).toBe(true);
    expect(consumeRateLimit(request, "auth").allowed).toBe(false);
    expect(consumeRateLimit(new Request("http://localhost/api/control", {headers: {"user-agent":"auth-test"}}), "api").allowed).toBe(true);
  });

  it("identifiziert authentifizierte Sessions unabhängig vom User-Agent", () => {
    process.env.BOB_RATE_LIMIT_MAX = "1";
    const a = new Request("http://localhost/api/control", {headers: {cookie:"bob_session=SES-A.secret", "user-agent":"one"}});
    const b = new Request("http://localhost/api/control", {headers: {cookie:"bob_session=SES-A.other", "user-agent":"two"}});
    expect(consumeRateLimit(a, "api").allowed).toBe(true);
    expect(consumeRateLimit(b, "api").allowed).toBe(false);
  });

  it("setzt beim Shutdown einen persistenten Drain-Zustand", () => {
    expect(isShuttingDown()).toBe(false);
    beginShutdown("TEST");
    expect(isShuttingDown()).toBe(true);
    expect(shutdownStatus().draining).toBe(true);
    expect(shutdownStatus().startedAt).toEqual(expect.any(String));
  });

  it("erkennt den vom Prozess gesetzten Shutdown-Status", () => {
    process.env.BOB_SHUTTING_DOWN = "1";
    expect(isShuttingDown()).toBe(true);
  });
});
