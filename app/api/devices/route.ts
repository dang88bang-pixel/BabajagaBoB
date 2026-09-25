import {NextResponse} from "next/server";
import {allocateDevice,authorizeDevice,discoverDevice,listDevices,releaseDevice} from "../../../lib/devices";
import {actionField,readJson,stringField} from "../../../lib/request-validation";
import {requireControlPlaneAuth} from "../../../lib/control-auth";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(){
 return NextResponse.json({devices:listDevices()},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request:Request){
 try{
  requireControlPlaneAuth(request);
  const b=await readJson(request);
  const action=actionField(b,["discover","authorize","allocate","release"]);
  if(action==="discover"){
   if(!b.device||typeof b.device!=="object"||Array.isArray(b.device))throw new Error("device object required");
   return NextResponse.json(discoverDevice(b.device as Parameters<typeof discoverDevice>[0]),{status:201});
  }
  const id=stringField(b,"id",128);
  if(action==="authorize"){
   if(typeof b.authorized!=="boolean")throw new Error("authorized must be boolean");
   return NextResponse.json(authorizeDevice(id,b.authorized));
  }
  if(action==="allocate")return NextResponse.json(allocateDevice(id,stringField(b,"taskId",128)));
  return NextResponse.json(releaseDevice(id));
 }catch(e){
  return NextResponse.json({error:e instanceof Error?e.message:"device error"},{status:400});
 }
}
