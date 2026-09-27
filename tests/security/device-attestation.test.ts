import crypto from "node:crypto";
import {describe,it,expect,beforeEach} from "vitest";

describe("device cryptographic attestation",()=>{
  beforeEach(()=>{process.env.BOB_STORAGE_DIR="/tmp/bob-attestation-tests-"+crypto.randomUUID();});
  it("registers Ed25519 key, issues nonce and verifies a real signature",async()=>{
    const m=await import("../../lib/device-attestation");
    const kp=crypto.generateKeyPairSync("ed25519");
    const pub=kp.publicKey.export({type:"spki",format:"pem"}).toString();
    m.registerDeviceAttestation("DEV-ATTEST-001",pub);
    const c=m.issueAttestationChallenge("DEV-ATTEST-001");
    const payload=Buffer.from(JSON.stringify({deviceId:c.deviceId,nonce:c.nonce}));
    const sig=crypto.sign(null,payload,kp.privateKey).toString("base64url");
    const v=m.verifyDeviceAttestation(c.deviceId,c.nonce,sig);
    expect(v.verified).toBe(true);
  });
  it("rejects replay and invalid signatures",async()=>{
    const m=await import("../../lib/device-attestation");
    const kp=crypto.generateKeyPairSync("ed25519");
    m.registerDeviceAttestation("DEV-ATTEST-002",kp.publicKey.export({type:"spki",format:"pem"}).toString());
    const c=m.issueAttestationChallenge("DEV-ATTEST-002");
    const bad=crypto.sign(null,Buffer.from("wrong"),kp.privateKey).toString("base64url");
    expect(m.verifyDeviceAttestation(c.deviceId,c.nonce,bad).verified).toBe(false);
    const good=crypto.sign(null,Buffer.from(JSON.stringify({deviceId:c.deviceId,nonce:c.nonce})),kp.privateKey).toString("base64url");
    expect(m.verifyDeviceAttestation(c.deviceId,c.nonce,good).verified).toBe(true);
    expect(m.verifyDeviceAttestation(c.deviceId,c.nonce,good).verified).toBe(false);
  });
});
