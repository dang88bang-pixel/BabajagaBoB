import {listTools,registerTool} from "../../../lib/tool-registry";

export async function GET(){return Response.json({tools:listTools()})}
export async function POST(request:Request){
 try{
  const body=await request.json();
  return Response.json({tool:registerTool(body)},{status:201});
 }catch(error){
  return Response.json({error:error instanceof Error?error.message:"invalid tool"},{status:400});
 }
}
