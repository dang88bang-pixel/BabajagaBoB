import {spawn} from "node:child_process";
import crypto from "node:crypto";
import {recordAudit} from "./audit";
import {observe} from "./observability";
import {listComputers} from "./computer-use";

export type ComputerExecutionRequest = {
  computerId: string;
  action: string;
  input: Record<string, unknown>;
  timeoutMs?: number;
};

export type ComputerExecutionResult = {
  computerId: string;
  action: string;
  status: "SUCCEEDED"|"FAILED"|"BLOCKED";
  exitCode: number|null;
  stdoutDigest: string;
  stderrDigest: string;
  stdoutLength: number;
  stderrLength: number;
  durationMs: number;
};

const ALLOWED = new Set(["NAVIGATE","CLICK","TYPE","SELECT","SCREENSHOT","OCR","PROCESS_READ","FILE_READ","TERMINAL_EXECUTE"]);
const digest=(value:string)=>crypto.createHash("sha256").update(value).digest("hex");

export async function executeComputerAction(req: ComputerExecutionRequest): Promise<ComputerExecutionResult> {
  const instance=listComputers().find(x=>x.id===req.computerId);
  if(!instance) throw new Error("computer not found");
  if(!instance.authorized) throw new Error("computer is not authorized");
  if(instance.state!=="EXECUTING") throw new Error("computer must be executing");
  if(!ALLOWED.has(req.action)) throw new Error("computer action is not allowed");
  if(!instance.capabilities.some(c=>c.kind===instance.kind && c.actions.includes(req.action as never))) throw new Error("computer capability does not permit action");
  const command=(process.env.BOB_COMPUTER_DRIVER ?? "").trim();
  if (/\s/.test(command) || command.includes(";") || command.includes("|") || command.includes("&")) throw new Error("computer driver path is invalid");
  if(!command) {
    recordAudit({actor:"AG-BROWSER",action:"computer.execute",resource:req.computerId,decision:"DENY"},{reason:"DRIVER_NOT_CONFIGURED",action:req.action});
    throw new Error("computer driver is not configured; execution remains fail closed");
  }
  const timeout=Math.min(Math.max(Number(req.timeoutMs??30000),1000),120000);
  const started=Date.now();
  const result=await new Promise<{code:number|null;stdout:string;stderr:string}>((resolve)=>{
    const safeEnv: NodeJS.ProcessEnv={NODE_ENV:process.env.NODE_ENV ?? "production",PATH:process.env.PATH,LANG:process.env.LANG,LC_ALL:process.env.LC_ALL,TZ:process.env.TZ};
    const child=spawn(command,[],{shell:false,stdio:["pipe","pipe","pipe"],env:safeEnv});
    let stdout="",stderr="",settled=false;
    const finish=(value:{code:number|null;stdout:string;stderr:string})=>{if(!settled){settled=true;clearTimeout(timer);resolve(value);}};
    const timer=setTimeout(()=>{child.kill("SIGKILL");finish({code:null,stdout,stderr:stderr+"timeout"});},timeout);
    child.stdout.on("data",b=>{stdout+=String(b);if(stdout.length>1_000_000) child.kill("SIGKILL");});
    child.stderr.on("data",b=>{stderr+=String(b);if(stderr.length>1_000_000) child.kill("SIGKILL");});
    child.on("error",e=>{finish({code:null,stdout,stderr:stderr+(e instanceof Error?e.message:String(e))});});
    child.stdin.on("error",e=>{
      // A short-lived driver may exit immediately after producing its response.
      // Treat a late EPIPE as transport noise; the child exit code remains authoritative.
      if ((e as NodeJS.ErrnoException).code !== "EPIPE") finish({code:null,stdout,stderr:stderr+String(e)});
    });
    child.on("close",code=>finish({code,stdout,stderr}));
    try {
      child.stdin.end(JSON.stringify({computerId:req.computerId,kind:instance.kind,action:req.action,input:req.input}));
    } catch (e) {
      finish({code:null,stdout,stderr:stderr+(e instanceof Error?e.message:String(e))});
    }
  });
  const out:ComputerExecutionResult={
    computerId:req.computerId,action:req.action,status:result.code===0?"SUCCEEDED":"FAILED",exitCode:result.code,
    stdoutDigest:digest(result.stdout),stderrDigest:digest(result.stderr),stdoutLength:result.stdout.length,stderrLength:result.stderr.length,durationMs:Date.now()-started
  };
  recordAudit({actor:"AG-BROWSER",action:"computer.execute",resource:req.computerId,decision:out.status==="SUCCEEDED"?"ALLOW":"DENY"},{
    action:req.action,exitCode:out.exitCode,stdoutDigest:out.stdoutDigest,stderrDigest:out.stderrDigest,durationMs:out.durationMs
  });
  observe({type:"computer.executed",message:`Computer ${req.computerId} ${req.action} -> ${out.status}`,status:out.status==="SUCCEEDED"?"COMPLETED":"ERROR",actor:"AG-BROWSER",agentId:"AG-BROWSER",action:"computer.execute",resource:req.computerId,decision:out.status==="SUCCEEDED"?"ALLOW":"DENY",argumentsValue:{action:req.action,exitCode:out.exitCode}});
  return out;
}
