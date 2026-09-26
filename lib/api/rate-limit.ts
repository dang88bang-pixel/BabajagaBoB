import crypto from "node:crypto";

type Bucket = {count:number; resetAt:number};
const buckets = new Map<string, Bucket>();

function numberEnv(name:string, fallback:number, min:number, max:number):number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value < min || value > max) return fallback;
  return Math.floor(value);
}

function identity(request:Request):string {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)bob_session=([^;]+)/);
  if (match) return "session:" + match[1].split(".")[0];
  if (process.env.BOB_TRUST_PROXY === "1") {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return "ip:" + forwarded;
  }
  return "anonymous:" + crypto.createHash("sha256").update(request.headers.get("user-agent") ?? "unknown").digest("hex").slice(0,16);
}

export type RateLimitDecision = {allowed:true; remaining:number; resetAt:number} | {allowed:false; retryAfterSeconds:number; resetAt:number};

export function consumeRateLimit(request:Request, bucketName:string):RateLimitDecision {
  const windowMs = numberEnv("BOB_RATE_LIMIT_WINDOW_MS", 60_000, 1_000, 3_600_000);
  const max = numberEnv(bucketName === "auth" ? "BOB_AUTH_RATE_LIMIT_MAX" : "BOB_RATE_LIMIT_MAX", bucketName === "auth" ? 30 : 120, 1, 100_000);
  const now = Date.now();
  const key = bucketName + ":" + identity(request);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, {count:1, resetAt});
    return {allowed:true, remaining:max - 1, resetAt};
  }
  if (current.count >= max) {
    return {allowed:false, retryAfterSeconds:Math.max(1, Math.ceil((current.resetAt-now)/1000)), resetAt:current.resetAt};
  }
  current.count += 1;
  return {allowed:true, remaining:max-current.count, resetAt:current.resetAt};
}

/**
 * Gehashte Kennung des anfragenden Clients für Audit-Zwecke. Bewusst nur ein
 * Digest: Die Serverkennung (Session, IP oder User-Agent) darf nie im Klartext
 * im Audit landen, muss aber über mehrere Vorfälle hinweg korrelierbar sein.
 */
export function rateLimitIdentityDigest(request:Request):string {
  return crypto.createHash("sha256").update(identity(request)).digest("hex").slice(0,16);
}

export function rateLimitResetForTests():void { buckets.clear(); }