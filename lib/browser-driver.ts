import {spawn} from "node:child_process";
import {mkdtemp, rm, readFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

type Input = Record<string, unknown>;
type CdpResult = {result?: {value?: unknown;data?: string};error?: {message?: string}};

const digest=(v:string)=>crypto.createHash("sha256").update(v).digest("hex");
const executable=()=> (process.env.BOB_BROWSER_EXECUTABLE ?? "").trim();

function command(browser: WebSocket, id:number, method:string, params:Record<string,unknown>={}):Promise<CdpResult>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{browser.removeEventListener("message",onMessage);reject(new Error("browser command timeout"));},15000);
    const onMessage=(event:MessageEvent)=>{
      try {
        const message=JSON.parse(String(event.data));
        if(message.id!==id)return;
        clearTimeout(timer);browser.removeEventListener("message",onMessage);
        if(message.error) reject(new Error(message.error.message??"browser command failed"));
        else resolve(message);
      } catch { /* ignore unrelated websocket messages */ }
    };
    browser.addEventListener("message",onMessage);
    browser.send(JSON.stringify({id,method,params}));
  });
}

async function waitForWs(port:number, deadline:number):Promise<string>{
  while(Date.now()<deadline){
    try {
      const r=await fetch(`http://127.0.0.1:${port}/json/version`);
      if(r.ok){const j=await r.json() as {webSocketDebuggerUrl?:string};if(j.webSocketDebuggerUrl)return j.webSocketDebuggerUrl;}
    } catch { /* endpoint not ready yet */ }
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error("browser DevTools endpoint unavailable");
}

async function launch(exe:string,timeoutMs:number){
  const profile=await mkdtemp(path.join(os.tmpdir(),"bob-browser-"));
  const args=["--headless=new","--disable-gpu","--disable-software-rasterizer","--disable-dev-shm-usage","--no-sandbox","--disable-setuid-sandbox","--disable-crash-reporter","--disable-extensions","--disable-background-networking","--disable-sync","--no-first-run","--no-default-browser-check","--host-resolver-rules=MAP * ~NOTFOUND,EXCLUDE localhost","--remote-debugging-address=127.0.0.1","--remote-debugging-port=9222",`--user-data-dir=${profile}`,"about:blank"];
  const child=spawn(exe,args,{shell:false,stdio:["ignore","pipe","pipe"],env:{PATH:process.env.PATH,LANG:process.env.LANG,HOME:profile}});
  let text="";
  const collect=(b:Buffer)=>{text+=String(b);if(text.length>128000)text=text.slice(-128000);};
  child.stdout.on("data",collect); child.stderr.on("data",collect);
  const deadline=Date.now()+Math.min(Math.max(timeoutMs,1000),120000);
  const port=9222;
  while(Date.now()<deadline && child.exitCode===null){
    try {
      const probe=await fetch(`http://127.0.0.1:${port}/json/version`);
      if(probe.ok) break;
    } catch { /* browser endpoint not ready */ }
    await new Promise(r=>setTimeout(r,50));
  }
  if(child.exitCode!==null){
    const diagnostics=text.trim().slice(-4000);
    await rm(profile,{recursive:true,force:true});
    throw new Error(`browser exited before DevTools: ${diagnostics}`);
  }
  const wsUrl=await waitForWs(port,deadline);
  const ws=new WebSocket(wsUrl);
  await new Promise<void>((resolve,reject)=>{const t=setTimeout(()=>reject(new Error("browser websocket timeout")),5000);ws.addEventListener("open",()=>{clearTimeout(t);resolve()},{once:true});ws.addEventListener("error",()=>{clearTimeout(t);reject(new Error("browser websocket error"))},{once:true});});
  return {child,ws,profile};
}

async function screenshotFallback(exe:string,timeoutMs:number){
  const dir=await mkdtemp(path.join(os.tmpdir(),"bob-browser-shot-"));
  const file=path.join(dir,"screenshot.png");
  const child=spawn(exe,["--headless=new","--disable-gpu","--disable-dev-shm-usage","--no-sandbox","--disable-setuid-sandbox","--disable-extensions",`--screenshot=${file}`,"about:blank"],{shell:false,stdio:["ignore","pipe","pipe"],env:{PATH:process.env.PATH,LANG:process.env.LANG,HOME:dir}});
  const started=Date.now();
  try {
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{if(child.exitCode===null)child.kill("SIGKILL");reject(new Error("browser screenshot timeout"));},Math.min(Math.max(timeoutMs,1000),120000));
      child.once("error",error=>{clearTimeout(timer);reject(error);});
      child.once("exit",code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error(`browser screenshot exited with code ${code ?? "unknown"}`));});
    });
    const data=await readFile(file);
    const base64=data.toString("base64");
    return {ok:true,action:"SCREENSHOT",bytes:data.byteLength,digest:digest(base64),encoding:"base64",durationMs:Date.now()-started};
  } finally {
    if(child.exitCode===null)child.kill("SIGKILL");
    await rm(dir,{recursive:true,force:true});
  }
}

export async function executeBrowserAction(action:string,input:Input,timeoutMs=30000){
  const exe=executable();
  if(!exe) throw new Error("BOB_BROWSER_EXECUTABLE is not configured");
  if(/[\s;|&]/.test(exe)) throw new Error("browser executable path is invalid");
  if(action==="SCREENSHOT") return screenshotFallback(exe,timeoutMs);
  if(action==="NAVIGATE") {
    const url=typeof input.url==="string"?input.url:"";
    if(!/^https?:\\/\\//i.test(url)) throw new Error("NAVIGATE requires an http(s) URL");
    const parsed=new URL(url);
    if(!["localhost","127.0.0.1","[::1]"].includes(parsed.hostname)) throw new Error("external browser navigation is blocked by default-deny network policy");
  }
  const browser=await launch(exe,timeoutMs);
  let id=0;
  try{
    await command(browser.ws,++id,"Page.enable");
    await command(browser.ws,++id,"Runtime.enable");
    switch(action){
      case "NAVIGATE": {
        const url=typeof input.url==="string"?input.url:"";
        await command(browser.ws,++id,"Page.navigate",{url});
        return {ok:true,action,url};
      }
      case "CLICK": {
        const selector=typeof input.selector==="string"?input.selector:"";
        if(!selector)throw new Error("CLICK requires selector");
        const r=await command(browser.ws,++id,"Runtime.evaluate",{expression:`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error("element not found");e.click();return true})()`,returnByValue:true});
        return {ok:true,action,value:r.result?.value};
      }
      case "TYPE": {
        const selector=typeof input.selector==="string"?input.selector:"";
        const value=typeof input.text==="string"?input.text:"";
        if(!selector)throw new Error("TYPE requires selector");
        const r=await command(browser.ws,++id,"Runtime.evaluate",{expression:`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error("element not found");e.focus();e.value=${JSON.stringify(value)};e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()`,returnByValue:true});
        return {ok:true,action,value:r.result?.value};
      }
      case "SELECT": {
        const selector=typeof input.selector==="string"?input.selector:"";
        const value=typeof input.value==="string"?input.value:"";
        if(!selector)throw new Error("SELECT requires selector");
        const r=await command(browser.ws,++id,"Runtime.evaluate",{expression:`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error("element not found");e.value=${JSON.stringify(value)};e.dispatchEvent(new Event("change",{bubbles:true}));return true})()`,returnByValue:true});
        return {ok:true,action,value:r.result?.value};
      }
      case "SCREENSHOT": {
        const r=await command(browser.ws,++id,"Page.captureScreenshot",{format:"png"});
        const data=r.result?.data??"";
        return {ok:true,action,bytes:Math.floor(data.length*0.75),digest:digest(data),encoding:"base64"};
      }
      case "OCR": {
        throw new Error("OCR requires an explicitly configured OCR capability; browser text extraction is not OCR");
      }
      default:
        throw new Error(`browser action not supported: ${action}`);
    }
  } finally {
    browser.ws.close();
    if(browser.child.exitCode===null) browser.child.kill("SIGKILL");
    await new Promise<void>(resolve=>{
      if(browser.child.exitCode!==null){resolve();return;}
      const timer=setTimeout(resolve,1000);
      browser.child.once("exit",()=>{clearTimeout(timer);resolve();});
    });
    await rm(browser.profile,{recursive:true,force:true});
  }
}
