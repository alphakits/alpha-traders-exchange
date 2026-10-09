import { describe,expect,it } from "vitest";
import { metrics,parseMoney,dayInZone,inPeriod,weekStart,shiftDate,validDate,type JournalTrade } from "./model";
import { journalTradeInput,journalReviewInput } from "./validation";
import { canShowInterfaceLink } from "@alpha-traders/contracts";
import { isProtectedPage } from "@/lib/protected-page";
const trade=(overrides:Partial<JournalTrade>={}):JournalTrade=>({id:"10000000-0000-4000-8000-000000000001",version:0,date:"2026-10-08",time:"10:00",symbol:"NQ",direction:"long",status:"closed",grossPnlCents:10000,feesCents:500,riskCents:5000,quantity:null,entry:null,exit:null,stop:null,target:null,strategy:"FVG",session:"new_york",emotion:"calm",followedPlan:true,mistakes:[],notes:"",...overrides});
describe("journal financial calculations",()=>{
  it("offers private journal navigation to buyers, sellers and students, while protecting both locales",()=>{
    for(const role of ["buyer","approved_seller","student"])expect(canShowInterfaceLink("/journal",{role})).toBe(true);
    expect(canShowInterfaceLink("/journal",null)).toBe(false);
    expect(isProtectedPage("/en/journal")).toBe(true);expect(isProtectedPage("/ar/journal")).toBe(true);
  });
  it("uses integer cents, rejects ambiguous input, and keeps zero as break-even",()=>{
    expect(parseMoney("0.29")).toBe(29);expect(parseMoney("-12.10")).toBe(-1210);expect(parseMoney("0")).toBe(0);
    for(const value of ["","abc","1,000","1e3","Infinity","1.005"])expect(parseMoney(value)).toBeNull();
  });
  it("deducts fees before deciding wins/losses and excludes open results",()=>{
    const value=metrics([trade(),trade({grossPnlCents:500}),trade({grossPnlCents:300}),trade({grossPnlCents:-10000}),trade({status:"open",grossPnlCents:0,feesCents:100})]);
    expect(value).toMatchObject({net:-1200,fees:2000,count:4,open:1,wins:1,lossCount:2,breakeven:1,winRate:25,expectancy:-300,gains:9500,losses:10700});
    expect(value.profitFactor).toBeCloseTo(9500/10700);
  });
  it("calculates drawdown chronologically, starting at zero even when the first trade loses",()=>{
    expect(metrics([trade({date:"2026-10-09",grossPnlCents:10000,feesCents:0}),trade({date:"2026-10-08",grossPnlCents:-5000,feesCents:0}),trade({date:"2026-10-10",grossPnlCents:-8000,feesCents:0})]).maxDrawdown).toBe(8000);
  });
  it("does not invent ratios, win rates, or behavior scores without observations",()=>{
    expect(metrics([])).toMatchObject({winRate:null,profitFactor:null,averageR:null,discipline:null});
    expect(metrics([trade({followedPlan:null,riskCents:null})])).toMatchObject({discipline:null,assessed:0,averageR:null,rCount:0,profitFactor:null});
  });
  it("keeps session dates stable across DST and Sunday/Monday week boundaries",()=>{
    expect(weekStart("2026-10-11")).toBe("2026-10-05");expect(weekStart("2026-10-12")).toBe("2026-10-12");
    expect(dayInZone("America/New_York",new Date("2026-10-09T01:00:00Z"))).toBe("2026-10-08");
    expect(shiftDate("2026-10-25",1)).toBe("2026-10-26");expect(inPeriod("2026-10-01","month","2026-10-31")).toBe(true);
    expect(validDate("2026-02-30")).toBe(false);expect(validDate("2028-02-29")).toBe(true);
  });
  it("rejects owner injection, unsupported image-like fields, NaN and realized open P&L",()=>{
    expect(journalTradeInput.safeParse({...trade(),userId:"other-user"}).success).toBe(false);
    expect(journalTradeInput.safeParse({...trade(),image:"<svg onload=alert(1)>"}).success).toBe(false);
    expect(journalTradeInput.safeParse(trade({grossPnlCents:NaN})).success).toBe(false);
    expect(journalTradeInput.safeParse(trade({status:"open",grossPnlCents:100})).success).toBe(false);
    expect(journalTradeInput.safeParse(trade({grossPnlCents:0,status:"open"})).success).toBe(true);
    expect(journalReviewInput.safeParse({date:"2026-10-08",period:"week",version:0,preparation:"",wentWell:"",improve:"",nextSession:"",rating:6}).success).toBe(false);
  });
});
