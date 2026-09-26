import crypto from "node:crypto";
export function requireControlPlaneAuth(request:Request){
 const expected=process.env.BOB_CONTROL_PLANE_TOKEN;
 if(!expected)throw new Error("control-plane authentication is not configured");
 const header=request.headers.get("authorization")??"";
 const supplied=header.startsWith("Bearer ")?header.slice(7):"";
 if(!supplied)throw new Error("control-plane authorization required");
 const a=Buffer.from(supplied),b=Buffer.from(expected);
 if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw new Error("control-plane authorization denied");
}
