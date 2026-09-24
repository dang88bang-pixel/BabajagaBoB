export type DataClass="DEVICE"|"USER"|"APP"|"BROWSER"|"NETWORK"|"THIRD_PARTY"|"SECRET"|"ARTIFACT";
export type PrivacyRule={dataClass:DataClass;sharing:"DENY";storage:"LOCAL_ONLY";reason:string};
export const privacyRules:PrivacyRule[]=[
 {dataClass:"DEVICE",sharing:"DENY",storage:"LOCAL_ONLY",reason:"Device discovery never implies external disclosure"},
 {dataClass:"USER",sharing:"DENY",storage:"LOCAL_ONLY",reason:"User data remains inside the control boundary"},
 {dataClass:"APP",sharing:"DENY",storage:"LOCAL_ONLY",reason:"Application telemetry is not sent by default"},
 {dataClass:"BROWSER",sharing:"DENY",storage:"LOCAL_ONLY",reason:"Browser context is not shared by default"},
 {dataClass:"NETWORK",sharing:"DENY",storage:"LOCAL_ONLY",reason:"Network metadata stays inside the boundary"},
 {dataClass:"THIRD_PARTY",sharing:"DENY",storage:"LOCAL_ONLY",reason:"No silent third-party provider"},
 {dataClass:"SECRET",sharing:"DENY",storage:"LOCAL_ONLY",reason:"Secrets require brokered short-lived leases"},
 {dataClass:"ARTIFACT",sharing:"DENY",storage:"LOCAL_ONLY",reason:"Artifacts stay in the configured persistence boundary"}
];
export function privacySnapshot(){return structuredClone(privacyRules)}
