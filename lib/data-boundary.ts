import crypto from "node:crypto";
import {privacyPolicy} from "./privacy";

export type ProtectedDataClass="DEVICE"|"USER"|"APP"|"BROWSER"|"NETWORK"|"THIRD_PARTY"|"SECRET"|"ARTIFACT"|"OTHER";
export type ExternalDataRequest={
 destination:string;
 dataClass:ProtectedDataClass;
 encrypted:boolean;
 allowlisted:boolean;
 purpose:string;
};
export type EncryptedEnvelope={
 algorithm:"AES-256-GCM";
 keyId:string;
 iv:string;
 ciphertext:string;
 authTag:string;
};

export class DataBoundaryError extends Error{
 constructor(message:string){super(message);this.name="DataBoundaryError";}
}

export function assertExternalTransmission(request:ExternalDataRequest){
 if(!request.destination)throw new DataBoundaryError("External destination is required");
 if(!request.allowlisted)throw new DataBoundaryError("External destination is not allowlisted");
 if(!request.encrypted)throw new DataBoundaryError("Unencrypted external data transmission is forbidden");
 if(privacyPolicy.externalDisclosure==="DENY")throw new DataBoundaryError("External data disclosure is disabled by privacy policy");
 if(privacyPolicy.externalProcessing==="DENY")throw new DataBoundaryError("External processing is disabled by privacy policy");
}

export function assertNoProtectedDataForThirdParty(dataClass:ProtectedDataClass){
 throw new DataBoundaryError(`Protected data class ${dataClass} cannot be disclosed to third parties`);
}

export function encryptLocalEnvelope(value:unknown,keyId:string,key:Buffer):EncryptedEnvelope{
 if(key.length!==32)throw new DataBoundaryError("BOB encryption key must be exactly 32 bytes");
 const iv=crypto.randomBytes(12);
 const cipher=crypto.createCipheriv("aes-256-gcm",key,iv);
 const plaintext=Buffer.from(JSON.stringify(value),"utf8");
 const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
 return {
  algorithm:"AES-256-GCM",
  keyId,
  iv:iv.toString("base64"),
  ciphertext:ciphertext.toString("base64"),
  authTag:cipher.getAuthTag().toString("base64")
 };
}

export function decryptLocalEnvelope(envelope:EncryptedEnvelope,key:Buffer){
 if(key.length!==32)throw new DataBoundaryError("BOB encryption key must be exactly 32 bytes");
 const decipher=crypto.createDecipheriv("aes-256-gcm",key,Buffer.from(envelope.iv,"base64"));
 decipher.setAuthTag(Buffer.from(envelope.authTag,"base64"));
 return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,"base64")),decipher.final()]).toString("utf8"));
}

export function dataBoundarySnapshot(){
 return {
  ...privacyPolicy,
  protectedClasses:["DEVICE","USER","APP","BROWSER","NETWORK","THIRD_PARTY","SECRET","ARTIFACT","OTHER"],
  encryptionAtRest:"AES-256-GCM when a local encryption key is configured",
  rawSecretForwarding:false
 };
}
