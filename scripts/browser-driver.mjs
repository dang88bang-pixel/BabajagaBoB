#!/usr/bin/env node
import {spawn} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import crypto from "node:crypto";

const executable=process.env.BOB_BROWSER_EXECUTABLE;
if(!executable) throw new Error("BOB_BROWSER_EXECUTABLE is required");
const port=Number(process.env.BOB_BROWSER_PORT||0)||39000+Math.floor(Math.random()*1000);
const profile=mkdtempSync(join(tmpdir(),"bob-browser-"));
const child=spawn(executable,["--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",`--remote-debugging-port=${port}`,`--user-data-dir=${profile}","about:blank"],{shell:false,stdio:["ignore","pipe","pipe"]});
let closed=false;
const cleanup=()=>{if(closed)return;closed=true;try{child.kill("SIGKILL")}catch{}try{rmSync(profile,{recursive:true,force:true})}catch{}};
process.on("exit",cleanup); process.on("SIGTERM",()=>{cleanup();process.exit(143)}); process.on("SIGINT",()=>{cleanup();process.exit(130)});
async function waitFor(url,ms=10000){const end=Date.now()+ms;while(Date.now()<end){try{const r=await fetch(url);if(r.ok)return await r.json()}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error("browser debugging endpoint unavailable");}
const version=await waitFor(`http://127.0.0.1:${port}/json/version`);
const ws=new WebSocket(version.webSocketDebuggerUrl);
let seq=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(String(e.data));if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}};
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,m=>m.error?reject(new Error(m.error.message)):resolve(m.result));ws.send(JSON.stringify({id,method,params}))});
await call("Page.enable"); await call("Runtime.enable");
const evalJs=async expression=>(await call("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true})).result?.value;
async function act(x){
 switch(x.action){
 case "NAVIGATE":{if(typeof x.input?.url!=="string"||!/^https?:$/.test(new URL(x.input.url).protocol))throw new Error("NAVIGATE requires http(s) URL");await call("Page.navigate",{url:x.input.url});return {ok:true,url:x.input.url};}
 case "CLICK":{const selector=String(x.input?.selector||"");if(!selector||selector.length>500)throw new Error("CLICK selector invalid");return {ok:Boolean(await evalJs(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true})()`))};}
 case "TYPE":{const selector=String(x.input?.selector||"");const text=String(x.input?.text??"");if(!selector||text.length>10000)throw new Error("TYPE input invalid");return {ok:Boolean(await evalJs(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.focus();if("value" in e)e.value=${JSON.stringify(text)};e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()`))};}
 case "SELECT":{const selector=String(x.input?.selector||"");const value=String(x.input?.value??"");return {ok:Boolean(await evalJs(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.value=${JSON.stringify(value)};e.dispatchEvent(new Event("change",{bubbles:true}));return true})()`))};}
 case "SCREENSHOT":{const r=await call("Page.captureScreenshot",{format:"png"});return {ok:true,base64:r.data,digest:crypto.createHash("sha256").update(r.data,"base64").digest("hex")};}
 case "PROCESS_READ":return {ok:true,pid:child.pid};
 default:throw new Error("unsupported browser action");
 }
}
let input="";
process.stdin.setEncoding("utf8");process.stdin.on("data",b=>input+=b);process.stdin.on("end",async()=>{try{const x=JSON.parse(input);const result=await act(x);process.stdout.write(JSON.stringify(result));}catch(e){process.stderr.write(e instanceof Error?e.message:String(e));process.exitCode=1}finally{try{ws.close()}catch{}cleanup();}});
