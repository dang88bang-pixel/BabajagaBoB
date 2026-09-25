import {listTools,registerTool} from "../../../lib/tool-registry";

import {guardOrDeny} from "../../../lib/api/api-gate";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"tool:read"});if(denied)return denied;return Response.json({tools:listTools()})}
export async function POST(request:Request){
 try{
  const denied=guardOrDeny(request,{action:"tool:register",creatorOnly:true});if(denied)return denied;
  const body=await request.json();
  return Response.json({tool:registerTool(body)},{status:201});
 }catch(error){
  return Response.json({error:error instanceof Error?error.message:"invalid tool"},{status:400});
 }
}
