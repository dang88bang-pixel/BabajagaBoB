import fs from "node:fs";
import path from "node:path";

const root=path.join(process.cwd(),"app","api");
const violations=[];
function walk(dir){
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const full=path.join(dir,entry.name);
  if(entry.isDirectory())walk(full);
  else if(entry.name==="route.ts"||entry.name==="route.tsx"){
   const source=fs.readFileSync(full,"utf8");
   if(/export\s+async\s+function\s+POST\s*\(/.test(source)&&!source.includes("requireControlPlaneAuth(")){
    violations.push(path.relative(process.cwd(),full));
   }
  }
 }
}
walk(root);
if(violations.length){
 console.error("Unauthenticated mutating API routes:");
 for(const v of violations)console.error(" - "+v);
 process.exit(1);
}
console.log("Security route check passed: all POST API routes require control-plane authentication.");
