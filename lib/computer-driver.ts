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
  status: "SUCCEEDED" | "FAILED" | "BLOCKED";
  exitCode: number | null;
  stdoutDigest: string;
  stderrDigest: string;
  stdoutLength: number;
  stderrLength: number;
  durationMs: number;
};

const ALLOWED = new Set(["NAVIGATE","CLICK","TYPE","SELECT","SCREENSHOT","OCR","PROCESS_READ","FILE_READ","TERMINAL_EXECUTE"]);
const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const MAX_OUTPUT = 1_000_000;

export async function executeComputerAction(req: ComputerExecutionRequest): Promise<ComputerExecutionResult> {
  const instance = listComputers().find(x => x.id === req.computerId);
  if (!instance) throw new Error("computer not found");
  if (!instance.authorized) throw new Error("computer is not authorized");
  if (instance.state !== "EXECUTING") throw new Error("computer must be executing");
  if (!ALLOWED.has(req.action)) throw new Error("computer action is not allowed");
  if (!instance.capabilities.some(c => c.kind === instance.kind && c.actions.includes(req.action as never))) {
    throw new Error("computer capability does not permit action");
  }

  const command = (process.env.BOB_COMPUTER_DRIVER ?? "").trim();
  if (!command) {
    recordAudit({actor:"AG-BROWSER",action:"computer.execute",resource:req.computerId,decision:"DENY"},{reason:"DRIVER_NOT_CONFIGURED",action:req.action});
    throw new Error("computer driver is not configured; execution remains fail closed");
  }
  if (/[\\s;|&<>\u0000]/.test(command)) throw new Error("computer driver path is invalid");
  const timeout = Math.min(Math.max(Number(req.timeoutMs ?? 30_000), 1_000), 120_000);
  const started = Date.now();
  const result = await new Promise<{code:number|null;stdout:string;stderr:string;timedOut:boolean}>((resolve) => {
    const safeEnv: NodeJS.ProcessEnv = {
      NODE_ENV: process.env.NODE_ENV ?? "production",
      PATH: process.env.PATH,
      LANG: process.env.LANG,
      LC_ALL: process.env.LC_ALL,
      TZ: process.env.TZ
    };
    const child = spawn(command, [], {shell:false, stdio:["pipe","pipe","pipe"], env:safeEnv});
    let stdout = "", stderr = "", timedOut = false, settled = false;
    const finish = (value:{code:number|null;stdout:string;stderr:string;timedOut:boolean}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      finish({code:null,stdout,stderr:"timeout",timedOut:true});
    }, timeout);
    child.stdout.on("data", chunk => {
      stdout += String(chunk);
      if (stdout.length > MAX_OUTPUT) { child.kill("SIGKILL"); finish({code:null,stdout:stdout.slice(0,MAX_OUTPUT),stderr:"stdout limit exceeded",timedOut:false}); }
    });
    child.stderr.on("data", chunk => {
      stderr += String(chunk);
      if (stderr.length > MAX_OUTPUT) { child.kill("SIGKILL"); finish({code:null,stdout,stderr:stderr.slice(0,MAX_OUTPUT),timedOut:false}); }
    });
    child.once("error", error => finish({code:null,stdout,stderr:String(error),timedOut:false}));
    child.stdin.on("error", error => {
      if ((error as NodeJS.ErrnoException).code !== "EPIPE") finish({code:null,stdout,stderr:String(error),timedOut:false});
    });
    child.once("close", code => finish({code,stdout,stderr,timedOut}));
    child.stdin.end(JSON.stringify({computerId:req.computerId,kind:instance.kind,action:req.action,input:req.input}));
  });

  const output: ComputerExecutionResult = {
    computerId:req.computerId,
    action:req.action,
    status:result.code === 0 && !result.timedOut ? "SUCCEEDED" : "FAILED",
    exitCode:result.code,
    stdoutDigest:digest(result.stdout),
    stderrDigest:digest(result.stderr),
    stdoutLength:result.stdout.length,
    stderrLength:result.stderr.length,
    durationMs:Date.now()-started
  };
  recordAudit({actor:"AG-BROWSER",action:"computer.execute",resource:req.computerId,decision:output.status==="SUCCEEDED"?"ALLOW":"DENY"},{
    action:req.action,exitCode:output.exitCode,stdoutDigest:output.stdoutDigest,stderrDigest:output.stderrDigest,durationMs:output.durationMs
  });
  observe({type:"computer.executed",message:`Computer ${req.computerId} ${req.action} -> ${output.status}`,status:output.status==="SUCCEEDED"?"COMPLETED":"ERROR",actor:"AG-BROWSER",action:"computer.execute",resource:req.computerId,decision:output.status==="SUCCEEDED"?"ALLOW":"DENY",argumentsValue:{action:req.action,exitCode:output.exitCode,stdoutDigest:output.stdoutDigest,stderrDigest:output.stderrDigest}});
  return output;
}
