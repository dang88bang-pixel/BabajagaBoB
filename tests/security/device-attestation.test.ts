import crypto from "node:crypto";
import {describe,it,expect,beforeEach} from "vitest";
describe("device cryptographic attestation",()=>{
 beforeEach(()=>{process.env.BOB_STORAGE_DIR="/tmp/bob-attestation-tests-"+crypto.randomUUID();});
 it("verifies a real Ed25519 signature and rejects replay",async()=>{
  const m=await import("../../lib/device-attestation"); const kp=crypto.generateKeyPairSync("ed25519");
  m.registerDeviceAttestation("DEV-ATTEST-001",kp.publicKey.export({type:"spki",format:"pem"}).toString());
  const c=m.issueAttestationChallenge("DEV-ATTEST-001"); const payload=Buffer.from(JSON.stringify({deviceId:c.deviceId,nonce:c.nonce}));
  const sig=crypto.sign(null,payload,kp.privateKey).toString("base64url");
  expect(m.verifyDeviceAttestation(c.deviceId,c.nonce,sig).verified).toBe(true);
  expect(m.verifyDeviceAttestation(c.deviceId,c.nonce,sig).verified).toBe(false);
 });
 it("rejects an invalid signature",async()=>{
  const m=await import("../../lib/device-attestation"); const kp=crypto.generateKeyPairSync("ed25519");
  m.registerDeviceAttestation("DEV-ATTEST-002",kp.publicKey.export({type:"spki",format:"pem"}).toString());
  const c=m.issueAttestationChallenge("DEV-ATTEST-002"); const bad=crypto.sign(null,Buffer.from("wrong"),kp.privateKey).toString("base64url");
  expect(m.verifyDeviceAttestation(c.deviceId,c.nonce,bad).verified).toBe(false);
 });
});