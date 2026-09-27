import {spawn} from "node:child_process";
import {createServer} from "node:http";
import {describe,it,expect} from "vitest";

const executable=process.env.BOB_BROWSER_EXECUTABLE;
const run=(action:string,input:Record<string,unknown>)=>new Promise<any>((resolve,reject)=>{
 const child=spawn("node",["scripts/browser-driver.mjs"],{shell:false,env:{...process.env,BOB_BROWSER_EXECUTABLE:executable}});
 let out="",err=""; child.stdout.on("data",b=>out+=b); child.stderr.on("data",b=>err+=b);
 child.on("error",reject); child.on("close",code=>code===0?resolve(JSON.parse(out)):reject(new Error(err||out||`driver exit ${code}`)));
 child.stdin.end(JSON.stringify({action,input}));
});

describe("real Chromium browser driver",()=>{
 it("navigates, clicks, types and captures a real screenshot",async()=>{
  if(!executable) return;
  const server=createServer((_req,res)=>{res.writeHead(200,{"content-type":"text/html"});res.end("<!doctype html><input id='x'><button id='b' onclick='document.body.dataset.clicked="yes"'>Go</button>");});
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));
  const port=(server.address() as any).port; const url=`http://127.0.0.1:${port}/`;
  try{
   expect((await run("NAVIGATE",{url})).ok).toBe(true);
   expect((await run("SCREENSHOT",{})).digest).toMatch(/^[a-f0-9]{64}$/);
   expect((await run("CLICK",{url,selector:"#b"})).ok).toBe(true);
   expect((await run("TYPE",{url,selector:"#x",text:"BabajagaBoB"})).ok).toBe(true);
  } finally {server.close();}
 },30000);
});
