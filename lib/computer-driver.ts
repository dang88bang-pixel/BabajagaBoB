import {spawn} from "node:child_process";
import crypto from "node:crypto";
import {recordAudit} from "./audit";
import {observe} from "./observability";
import {listComputers} from "./computer-use";
import {executeBrowserAction} from "./browser-driver";
import {executeBrowserAction} from "./browser-driver";

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
  const timeout=Math.min(Math.max(Number(req.timeoutMs??30000),1000),120000);
  if (instance.kind === "BROWSER") {
    const started=Date.now();
    try {
      const browserResult=await executeBrowserAction(req.action,req.input,timeout) as {ok:boolean;action:string;bytes?:number;digest?:string;encoding?:string;text?:string;html?:string;durationMs?:number};
      const stdout=JSON.stringify(browserResult);
      const out:ComputerExecutionResult={computerId:req.computerId,action:req.action,status:browserResult.ok?"SUCCEEDED":"FAILED",exitCode:browserResult.ok?0:1,stdoutDigest:digest(stdout),stderrDigest:digest(""),stdoutLength:stdout.length,stderrLength:0,durationMs:browserResult.durationMs??(Date.now()-started)};
      recordAudit({actor:"AG-BROWSER",action:"computer.execute",resource:req.computerId,decision:out.status==="SUCCEEDED"?"ALLOW":"DENY"},{action:req.action,exitCode:out.exitCode,stdoutDigest:out.stdoutDigest,stderrDigest:out.stderrDigest,durationMs:out.durationMs,driver:"CDP"});
      observe({type:"computer.executed",message:`Computer ${req.computerId} ${req.action} -> ${out.status}`,status:out.status==="SUCCEEDED"?"COMPLETED":"ERROR",actor:"AG-BROWSER",agentId:"AG-BROWSER",action:"computer.execute",resource:req.computerId,decision:out.status==="SUCCEEDED"?"ALLOW":"DENY",argumentsValue:{action:req.action,exitCode:out.exitCode,driver:"CDP"}});
      return out;
    } catch (error) {
      const message=error instanceof Error?error.message:String(error);
      const out:ComputerExecutionResult={computerId:req.computerId,action:req.action,status:"FAILED",exitCode:null,stdoutDigest:digest(""),stderrDigest:digest(message),stdoutLength:0,stderrLength:message.length,durationMs:Date.now()-started};
      recordAudit({actor:"AG-BROWSER",action:"computer.execute",resource:req.computerId,decision:"DENY"},{action:req.action,exitCode:null,stderrDigest:out.stderrDigest,durationMs:out.durationMs,driver:"CDP"});
      return out;
    }
  }
  const started=Date.now();
  // Browser-Instanzen verwenden den nativen CDP-Driver, sobald ein explizit
  // freigegebener Browser-Binary-Pfad vorhanden ist. Fehlt er, bleibt der
  // generische Driverpfad für Test-/Stub-Umgebungen bestehen und ist weiterhin
  // fail closed über BOB_COMPUTER_DRIVER.
  if(instance.kind === "BROWSER" && (process.env.BOB_BROWSER_EXECUTABLE ?? "").trim()) {
    const browserResult = await executeBrowserAction(req.action, req.input, timeout);
    const serialized = JSON.stringify(browserResult);
    const out:ComputerExecutionResult={
      computerId:req.computerId, action:req.action,
      status:browserResult.ok ? "SUCCEEDED" : "FAILED", exitCode:browserResult.ok ? 0 : 1,
      stdoutDigest:digest(serialized), stderrDigest:digest(""), stdoutLength:serialized.length, stderrLength:0,
      durationMs:Date.now()-started
    };
    recordAudit({actor:"AG-BROWSER",action:"computer.execute",resource:req.computerId,decision:out.status==="SUCCEEDED"?"ALLOW":"DENY"},
      {action:req.action,driver:"native-cdp",exitCode:out.exitCode,stdoutDigest:out.stdoutDigest,stderrDigest:out.stderrDigest,durationMs:out.durationMs});
    observe({type:"computer.executed",message:`Computer ${req.computerId} ${req.action} -> ${out.status}`,status:out.status==="SUCCEEDED"?"COMPLETED":"ERROR",actor:"AG-BROWSER",agentId:"AG-BROWSER",action:"computer.execute",resource:req.computerId,decision:out.status==="SUCCEEDED"?"ALLOW":"DENY",argumentsValue:{action:req.action,driver:"native-cdp"}});
    return out;
  }
  if (instance.kind === "BROWSER") {
    const started = Date.now();
    try {
      const browserResult = await executeBrowserAction(req.action, req.input, req.timeoutMs);
      const stdout = JSON.stringify(browserResult);
      const out: ComputerExecutionResult = {
        computerId: req.computerId,
        action: req.action,
        status: "SUCCEEDED",
        exitCode: 0,
        stdoutDigest: digest(stdout),
        stderrDigest: digest(""),
        stdoutLength: stdout.length,
        stderrLength: 0,
        durationMs: Date.now() - started
      };
      recordAudit({actor:"AG-BROWSER",action:"computer.execute",resource:req.computerId,decision:"ALLOW"}, {
        action:req.action, driver:"browser-driver", stdoutDigest:out.stdoutDigest, stdoutLength:out.stdoutLength, durationMs:out.durationMs
      });
      observe({type:"computer.browser-driver.completed",message:`Browser driver ${req.action} -> SUCCEEDED`,status:"COMPLETED",actor:"AG-BROWSER",agentId:"AG-BROWSER",action:"computer.execute",resource:req.computerId,decision:"ALLOW",argumentsValue:{action:req.action,stdoutDigest:out.stdoutDigest}});
      return out;
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error);
      const out: ComputerExecutionResult = {
        computerId:req.computerId, action:req.action, status:"FAILED", exitCode:null,
        stdoutDigest:digest(""), stderrDigest:digest(stderr), stdoutLength:0, stderrLength:stderr.length, durationMs:Date.now()-started
      };
      recordAudit({actor:"AG-BROWSER",action:"computer.execute",resource:req.computerId,decision:"DENY"}, {action:req.action,driver:"browser-driver",stderrDigest:out.stderrDigest});
      return out;
    }
  }


  const command=(process.env.BOB_COMPUTER_DRIVER ?? "").trim();
  if (/\s/.test(command) || command.includes(";") || command.includes("|") || command.includes("&")) throw new Error("computer driver path is invalid");
  if(!command) {
    recordAudit({actor:"AG-BROWSER",action:"computer.execute",resource:req.computerId,decision:"DENY"},{reason:"DRIVER_NOT_CONFIGURED",action:req.action});
    throw new Error("computer driver is not configured; execution remains fail closed");
  }
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
