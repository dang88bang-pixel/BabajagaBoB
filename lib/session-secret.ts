import crypto from "node:crypto";

export const SESSION_SECRET_ENV = "BOB_SESSION_SECRET";

export function sessionSecret():string {
  const value=process.env[SESSION_SECRET_ENV];
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(SESSION_SECRET_ENV + " is required in production");
  }
  return "development-only-session-secret";
}

export function hashSessionSecret(secret:string):string {
  return crypto.createHmac("sha256",sessionSecret()).update(secret).digest("hex");
}
