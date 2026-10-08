import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { JournalWorkspace } from "../src/components/journal/journal-workspace";
import { JournalClientError, type JournalAdapter, tradeInput } from "../src/lib/journal/client";
import { DEFAULT_SETTINGS, dayInZone, shiftDate, type JournalSnapshot, type JournalTrade, type JournalAttachment } from "../src/lib/journal/model";
import { journalReviewInput, journalSettingsInput, journalTradeInput } from "../src/lib/journal/validation";

type PreviewStore=JournalSnapshot & { charts:JournalAttachment[] };
function sample():PreviewStore {
  const today=dayInZone("Europe/Bucharest");
  const entries:[number,string,number,string,string,boolean,string[]][]=[
    [-18,"NQ",285,"FVG","calm",true,[]],[-17,"ES",146,"Liquidity sweep","confident",true,[]],
    [-16,"NQ",-112,"Breakout","fomo",false,["chased_entry"]],[-15,"XAUUSD",218,"Order block","calm",true,[]],
    [-14,"NQ",364,"FVG","confident",true,[]],[-13,"ES",-84,"Breakout","frustrated",false,["early_exit"]],
    [-10,"NQ",205,"FVG","calm",true,[]],[-9,"ES",-96,"Liquidity sweep","calm",true,[]],
    [-8,"MNQ",124,"Breaker block","confident",true,[]],[-7,"NQ",392,"FVG","calm",true,[]],
    [-6,"NQ",-166,"Breakout","revenge",false,["oversized","overtraded"]],
    [-3,"ES",254,"Liquidity sweep","calm",true,[]],[-2,"NQ",-110,"Breakout","fomo",false,["chased_entry"]],
    [-2,"NQ",326,"FVG","calm",true,[]],[-1,"MNQ",182,"Breaker block","confident",true,[]],
    [-1,"ES",4,"Liquidity sweep","fearful",false,["early_exit"]],
    [0,"NQ",286,"FVG","calm",true,[]],[0,"ES",-76,"Liquidity sweep","calm",true,[]],[0,"MNQ",196,"Breaker block","confident",true,[]],
  ];
  const trades=entries.map(([offset,symbol,gross,strategy,emotion,followedPlan,mistakes],i)=>({
    id:`10000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`,version:1,date:shiftDate(today,offset),time:i===16?"09:42":i===17?"10:16":i===18?"10:48":`${i%2?"10":"09"}:${String(12+i).padStart(2,"0")}`,
    symbol,direction:(i%4===1?"short":"long") as "long"|"short",status:"closed" as const,
    grossPnlCents:gross*100,feesCents:400,riskCents:10000,quantity:1,entry:null,exit:null,stop:null,target:null,
    strategy,session:"new_york",emotion,followedPlan,mistakes,
    notes:followedPlan?"Waited for the setup, defined my risk, and followed the exit plan.":"Entered before confirmation. Next time, wait for the full setup and check the plan before entry.",
  }));
  return {trades,charts:[],settings:{...DEFAULT_SETTINGS,version:1,timezone:"Europe/Bucharest",rules:"Wait for my setup.\nDefine risk before entering.\nReview the session before taking another trade."},reviews:[{date:today,period:"day",version:1,preparation:"Focus on New York. Wait for a clear liquidity sweep before considering a setup.",wentWell:"Stayed within the trade limit and accepted the ES stop without immediately entering again.",improve:"Keep capturing the chart before entering, not only after closing.",nextSession:"Only take setups I can explain in one sentence.",rating:4}]};
}
let dbPromise:Promise<IDBDatabase>|undefined;
function db(){return dbPromise??=new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open("alpha-journal-review-preview-v1",1);req.onupgradeneeded=()=>req.result.createObjectStore("journals");req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error("This browser could not open preview storage."));});}
function previewAdapter(mode:"sample"|"empty"):JournalAdapter {
  const access=async<T,>(fn:(store:PreviewStore)=>T,write=true):Promise<T>=>{
    const database=await db();return new Promise<T>((resolve,reject)=>{
      const transaction=database.transaction("journals","readwrite"),store=transaction.objectStore("journals"),req=store.get(mode);let output:T;
      req.onsuccess=()=>{try{const data:PreviewStore=req.result??(mode==="sample"?sample():{trades:[],reviews:[],charts:[],settings:{...DEFAULT_SETTINGS,timezone:"Europe/Bucharest"}});output=fn(data);if(write||!req.result)store.put(data,mode);}catch(e){reject(e);transaction.abort();}};
      transaction.oncomplete=()=>resolve(output);transaction.onerror=()=>reject(transaction.error??new Error("Preview was not saved."));
    });
  };
  return {
    load:()=>access(data=>({trades:data.trades,reviews:data.reviews,settings:data.settings}),false),
    saveTrade:trade=>access(data=>{
      const input=journalTradeInput.parse(tradeInput(trade));const existing=data.trades.find(t=>t.id===input.id);
      if((existing?.version??0)!==input.version)throw new JournalClientError("Trade changed. Reload before editing.",409);
      const next={...input,version:input.version+1};data.trades=[...data.trades.filter(t=>t.id!==input.id),next];return next;
    }),
    deleteTrade:trade=>access(data=>{if(data.trades.find(t=>t.id===trade.id)?.version!==trade.version)throw new JournalClientError("Trade changed. Reload before deleting.",409);data.trades=data.trades.filter(t=>t.id!==trade.id);data.charts=data.charts.filter(c=>c.tradeId!==trade.id);}),
    saveReview:review=>access(data=>{const next=journalReviewInput.parse(review);const current=data.reviews.find(r=>r.date===review.date&&r.period===review.period);if((current?.version??0)!==review.version)throw new JournalClientError("Review changed. Reload first.",409);next.version++;data.reviews=[...data.reviews.filter(r=>r.date!==review.date||r.period!==review.period),next];return next;}),
    saveSettings:settings=>access(data=>{if(data.settings.version!==settings.version)throw new JournalClientError("Rules changed. Reload first.",409);data.settings={...journalSettingsInput.parse(settings),version:settings.version+1};return data.settings;}),
    charts:id=>access(data=>data.charts.filter(c=>c.tradeId===id),false),
    uploadChart:async(id,file)=>{
      const url=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(file);});
      return access(data=>{if(!data.trades.some(t=>t.id===id))throw new Error("Save the trade first.");if(data.charts.filter(c=>c.tradeId===id).length>=3)throw new Error("Maximum 3 charts per trade.");const chart={id:crypto.randomUUID(),tradeId:id,name:"Chart",url};data.charts.push(chart);return chart;});
    },
    deleteChart:id=>access(data=>{data.charts=data.charts.filter(c=>c.id!==id);}),
  };
}
function Preview(){
  const [mode,setMode]=useState<"sample"|"empty">(()=>location.hash==="#empty"?"empty":"sample"),[locale,setLocale]=useState<"en"|"ar">("en");
  const adapter=useMemo(()=>previewAdapter(mode),[mode]);
  return <><div className="preview-banner"><div><strong>{locale==="ar"?"معاينة للمراجعة":"Review preview"}</strong><span>{mode==="sample"?(locale==="ar"?"بيانات تجريبية · محفوظة على هذا الجهاز فقط":"Sample data · saved on this device only"):(locale==="ar"?"تجربة فارغة · محفوظة على هذا الجهاز فقط":"Your test journal · saved on this device only")}</span></div><div><button onClick={()=>{if(window.confirm(locale==="ar"?"تبديل المعاينة؟ احفظ أي تعديلات أولاً.":"Switch preview? Save any open edits first.")){const next=mode==="sample"?"empty":"sample";setMode(next);location.hash=next;}}}>{mode==="sample"?(locale==="ar"?"جرّب سجلاً فارغاً":"Try an empty journal"):(locale==="ar"?"عرض المثال":"View sample journal")}</button><button onClick={()=>setLocale(locale==="en"?"ar":"en")}>{locale==="en"?"العربية":"English"}</button></div></div><JournalWorkspace key={mode} adapter={adapter} locale={locale} preview brandImage={window.JOURNAL_LOGO}/></>;
}
declare global{interface Window{JOURNAL_LOGO:string}}
createRoot(document.getElementById("root")!).render(<Preview/>);
