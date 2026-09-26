import {listTools,registerTool} from "../../../lib/tool-registry";

import {guardOrDeny} from "../../../lib/api/api-gate";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"tool:read"});if(denied)return denied;return Response.json({tools:listTools()})}
export async function POST(request:Request){
 try{
  const denied=guardOrDeny(request,{action:"tool:register",creatorOnly:true});if(denied)return denied;
  const body=await request.json();
  // Vertrag: {action:"register", tool:{…}} oder {action:"register", …definition}.
  // Früher wurde der ganze Body als Werkzeug registriert (inklusive `action`).
  if(body?.action!=="register")return Response.json({error:"unsupported action"},{status:400});
  const definition=(body.tool&&typeof body.tool==="object"&&!Array.isArray(body.tool))?body.tool:Object.fromEntries(Object.entries(body).filter(([key])=>key!=="action"));
  return Response.json({tool:registerTool(definition as Parameters<typeof registerTool>[0])},{status:201});
 }catch(error){
  return Response.json({error:error instanceof Error?error.message:"invalid tool"},{status:400});
 }
}
