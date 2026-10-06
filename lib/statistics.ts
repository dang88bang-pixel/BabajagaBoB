/** Deterministische, netzwerkfreie Statistik für Experimentmessungen. */
export type SampleSummary={n:number;mean:number;variance:number;standardDeviation:number};
export type WelchResult={baseline:SampleSummary;control:SampleSummary;difference:number;effectSize:number;degreesOfFreedom:number;tStatistic:number;pValue:number;significantAt05:boolean};

function clean(values:number[]):number[]{return values.filter(Number.isFinite);}
export function summarize(values:number[]):SampleSummary{
 const x=clean(values); if(x.length<2) throw new Error("mindestens zwei Messwerte erforderlich");
 const mean=x.reduce((a,b)=>a+b,0)/x.length;
 const variance=x.reduce((s,v)=>s+(v-mean)**2,0)/(x.length-1);
 return {n:x.length,mean,variance,standardDeviation:Math.sqrt(Math.max(0,variance))};
}
function logGamma(z:number):number{
 const coefficients=[676.5203681218851,-1259.1392167224028,771.3234287776531,-176.6150291621406,12.507343278686905,-0.13857109526572012,9.984369578019572e-6,1.5056327351493116e-7];
 if(z<0.5) return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-logGamma(1-z);
 z-=1; let x=0.9999999999998099; for(let i=0;i<coefficients.length;i++) x+=coefficients[i]/(z+i+1);
 const t=z+coefficients.length-0.5; return 0.5*Math.log(2*Math.PI)+(z+0.5)*Math.log(t)-t+Math.log(x);
}
function betaContinuedFraction(a:number,b:number,x:number):number{
 const max=200; const eps=3e-14; const fp=1e-300; let qab=a+b,qap=a+1,qam=a-1;
 let c=1; let d=1-qab*x/qap; if(Math.abs(d)<fp)d=fp; d=1/d; let h=d;
 for(let m=1;m<=max;m++){
  const m2=2*m; let aa=m*(b-m)*x/((qam+m2)*(a+m2)); d=1+aa*d; if(Math.abs(d)<fp)d=fp; c=1+aa/c; if(Math.abs(c)<fp)c=fp; d=1/d; h*=d*c;
  aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2)); d=1+aa*d; if(Math.abs(d)<fp)d=fp; c=1+aa/c; if(Math.abs(c)<fp)c=fp; d=1/d; const delta=d*c; h*=delta;
  if(Math.abs(delta-1)<eps) break;
 }
 return h;
}
function regularizedBeta(x:number,a:number,b:number):number{
 if(x<=0)return 0; if(x>=1)return 1;
 const front=Math.exp(a*Math.log(x)+b*Math.log1p(-x)+logGamma(a+b)-logGamma(a)-logGamma(b));
 return x<(a+1)/(a+b+2) ? front*betaContinuedFraction(a,b,x)/a : 1-front*betaContinuedFraction(b,a,1-x)/b;
}
function studentTwoSidedP(t:number,df:number):number{
 if(!Number.isFinite(t)||!Number.isFinite(df)||df<=0)return 1;
 const x=df/(df+t*t); return Math.min(1,Math.max(0,regularizedBeta(x,df/2,0.5)));
}
export function welchTTest(baseline:number[],control:number[]):WelchResult{
 const a=summarize(baseline),b=summarize(control); const va=a.variance/a.n,vb=b.variance/b.n;
 const se=Math.sqrt(va+vb); if(se===0) return {baseline:a,control:b,difference:b.mean-a.mean,effectSize:0,degreesOfFreedom:a.n+b.n-2,tStatistic:0,pValue:a.mean===b.mean?1:0,significantAt05:a.mean!==b.mean};
 const t=(b.mean-a.mean)/se; const df=(va+vb)**2/((va*va)/(a.n-1)+(vb*vb)/(b.n-1));
 const pooled=Math.sqrt(((a.n-1)*a.variance+(b.n-1)*b.variance)/(a.n+b.n-2)); const effectSize=pooled>0?(b.mean-a.mean)/pooled:0;
 const pValue=studentTwoSidedP(Math.abs(t),df);
 return {baseline:a,control:b,difference:b.mean-a.mean,effectSize,degreesOfFreedom:df,tStatistic:t,pValue,significantAt05:pValue<0.05};
}

/** Erwartet Evidence.value als JSON: {baseline:number[],control:number[]}. */
export function parseMeasurementPair(value:string):{baseline:number[];control:number[]} {
 let parsed:unknown; try{parsed=JSON.parse(value)}catch{throw new Error("MEASUREMENT-Evidence muss JSON enthalten");}
 if(!parsed||typeof parsed!=="object")throw new Error("MEASUREMENT-Evidence muss ein Objekt sein");
 const record=parsed as Record<string,unknown>;
 const baseline=Array.isArray(record.baseline)?record.baseline.filter(v=>typeof v==="number").map(v=>v as number):[];
 const control=Array.isArray(record.control)?record.control.filter(v=>typeof v==="number").map(v=>v as number):[];
 if(baseline.length<2||control.length<2)throw new Error("MEASUREMENT-Evidence benötigt mindestens zwei Werte je Gruppe");
 return {baseline,control};
}
