export type DataClass="DEVICE"|"USER"|"APP"|"BROWSER"|"NETWORK"|"THIRD_PARTY"|"SECRET"|"ARTIFACT"|"OTHER";
export type PrivacyRule={
 dataClass:DataClass;
 sharing:"DENY";
 storage:"LOCAL_ONLY";
 externalProcessing:"DENY";
 externalTraining:"DENY";
 reason:string;
};
export const privacyRules:PrivacyRule[]=[
 {dataClass:"DEVICE",sharing:"DENY",storage:"LOCAL_ONLY",externalProcessing:"DENY",externalTraining:"DENY",reason:"Device data never leaves the control boundary"},
 {dataClass:"USER",sharing:"DENY",storage:"LOCAL_ONLY",externalProcessing:"DENY",externalTraining:"DENY",reason:"User data never leaves the control boundary"},
 {dataClass:"APP",sharing:"DENY",storage:"LOCAL_ONLY",externalProcessing:"DENY",externalTraining:"DENY",reason:"Application data and telemetry never leave the control boundary"},
 {dataClass:"BROWSER",sharing:"DENY",storage:"LOCAL_ONLY",externalProcessing:"DENY",externalTraining:"DENY",reason:"Browser context, content and credentials never leave the control boundary"},
 {dataClass:"NETWORK",sharing:"DENY",storage:"LOCAL_ONLY",externalProcessing:"DENY",externalTraining:"DENY",reason:"Network metadata never leaves the control boundary"},
 {dataClass:"THIRD_PARTY",sharing:"DENY",storage:"LOCAL_ONLY",externalProcessing:"DENY",externalTraining:"DENY",reason:"Third-party data is not forwarded to other parties"},
 {dataClass:"SECRET",sharing:"DENY",storage:"LOCAL_ONLY",externalProcessing:"DENY",externalTraining:"DENY",reason:"Secrets remain brokered and local; raw secrets are never forwarded"},
 {dataClass:"ARTIFACT",sharing:"DENY",storage:"LOCAL_ONLY",externalProcessing:"DENY",externalTraining:"DENY",reason:"Artifacts remain inside the configured persistence boundary"},
 {dataClass:"OTHER",sharing:"DENY",storage:"LOCAL_ONLY",externalProcessing:"DENY",externalTraining:"DENY",reason:"Unknown or unclassified data fails closed"}
];
export const privacyPolicy={
 mode:"LOCAL_FIRST" as const,
 networkDefault:"DENY" as const,
 externalDisclosure:"DENY" as const,
 externalProcessing:"DENY" as const,
 externalTraining:"DENY" as const,
 externalStorage:"DENY" as const,
 unencryptedExternalData:"DENY" as const,
 failClosed:true,
};
export function privacySnapshot(){return structuredClone({policy:privacyPolicy,rules:privacyRules})}
