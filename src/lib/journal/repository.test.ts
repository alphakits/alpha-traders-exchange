// @vitest-environment node
import { beforeAll,afterAll,describe,it,expect,vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { NextRequest } from "next/server";
const state=vi.hoisted(()=>({db:null as PGlite|null,userId:"alice"}));
vi.mock("@/lib/postgres-runtime",()=>({getRuntimePostgresPool:()=>({connect:async()=>({query:async(sql:string,args?:unknown[])=>{const value=await state.db!.query(sql,args);return {...value,rowCount:value.affectedRows??value.rows.length};},release(){}})})}));
vi.mock("@/lib/api-auth",()=>({requireApiUser:async()=>({user:state.userId?{id:state.userId,role:"student"}:null,unauthorized:null})}));
vi.mock("@/lib/rate-limit",()=>({checkSharedRateLimit:async()=>({allowed:true}),createRateLimitResponse:vi.fn()}));
import { saveTrade,readJournal,deleteTrade,saveReview,saveSettings,reserveAttachment,finishAttachment,listAttachments,attachmentKey,deleteAttachment,JournalConflict,JournalNotFound,JournalLimit,withJournalUser } from "./repository";
import { DEFAULT_SETTINGS,type JournalTrade } from "./model";
import { POST } from "@/app/api/journal/trades/route";
const base:JournalTrade={id:"10000000-0000-4000-8000-000000000001",version:0,date:"2026-10-08",time:"09:30",symbol:"NQ",direction:"long",status:"closed",grossPnlCents:20000,feesCents:400,riskCents:10000,quantity:1,entry:null,exit:null,stop:null,target:null,strategy:"FVG",session:"new_york",emotion:"calm",followedPlan:true,mistakes:[],notes:"Private Alice note"};
beforeAll(async()=>{
  state.db=new PGlite();await state.db.exec(`create role anon;create role authenticated;create schema alpha_exchange;create table alpha_exchange.users(id text primary key);insert into alpha_exchange.users values('alice'),('bob');create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  await state.db.exec(await readFile("supabase/migrations/20261008200530_private_trading_journal.sql","utf8"));vi.stubEnv("ALPHA_JOURNAL_ENABLED","1");
});
afterAll(async()=>{await state.db?.close();vi.unstubAllEnvs();});
describe.sequential("private journal integration",()=>{
  it("creates and reads a trade through the real repository and SQL",async()=>{
    const saved=await saveTrade("alice",base);expect(saved.version).toBe(1);expect((await readJournal("alice")).trades[0].notes).toBe("Private Alice note");expect((await readJournal("bob")).trades).toEqual([]);
  });
  it("enforces RLS even if an application query forgets its owner WHERE",async()=>{
    const rows=await withJournalUser("bob",db=>db.query("select * from alpha_exchange.journal_trades"));expect(rows.rows).toHaveLength(0);
    await expect(withJournalUser("bob",db=>db.query("insert into alpha_exchange.journal_trades(user_id,id,trade_date,payload) values('alice','10000000-0000-4000-8000-000000000099','2026-10-08','{}')"))).rejects.toThrow();
    await expect(state.db!.exec("set role anon;select * from alpha_exchange.journal_trades")).rejects.toThrow();await state.db!.exec("reset role");
  });
  it("refuses another account's update and delete",async()=>{
    await expect(saveTrade("bob",{...base,version:1,notes:"stolen"})).rejects.toBeInstanceOf(JournalConflict);
    await expect(deleteTrade("bob",base.id,1)).rejects.toBeInstanceOf(JournalConflict);
    expect((await readJournal("alice")).trades[0].notes).toBe("Private Alice note");
  });
  it("rejects duplicate creation and stale edits without overwriting the winning save",async()=>{
    await expect(saveTrade("alice",base)).rejects.toBeInstanceOf(JournalConflict);
    const result=await saveTrade("alice",{...base,version:1,notes:"Newer saved note"});expect(result.version).toBe(2);
    await expect(saveTrade("alice",{...base,version:1,notes:"stale"})).rejects.toBeInstanceOf(JournalConflict);
    expect((await readJournal("alice")).trades[0].notes).toBe("Newer saved note");
  });
  it("saves daily and weekly reviews independently and guards settings conflicts",async()=>{
    const review={date:"2026-10-05",period:"day" as const,version:0,preparation:"",wentWell:"Patient",improve:"",nextSession:"",rating:4};
    await saveReview("alice",review);await saveReview("alice",{...review,period:"week",wentWell:"Weekly note"});
    expect((await readJournal("alice")).reviews).toHaveLength(2);expect((await readJournal("bob")).reviews).toEqual([]);
    expect((await saveSettings("alice",DEFAULT_SETTINGS)).version).toBe(1);
    await expect(saveSettings("alice",DEFAULT_SETTINGS)).rejects.toBeInstanceOf(JournalConflict);
  });
  it("protects attachment ownership, limits chart count, and queues deletion durably",async()=>{
    const id="20000000-0000-4000-8000-000000000001";
    await expect(reserveAttachment("bob",base.id,id,"Chart")).rejects.toBeInstanceOf(JournalNotFound);
    await reserveAttachment("alice",base.id,id,"Chart");await finishAttachment("alice",id);
    expect(await listAttachments("alice",base.id)).toHaveLength(1);expect(await listAttachments("bob",base.id)).toEqual([]);
    await expect(attachmentKey("bob",id)).rejects.toBeInstanceOf(JournalNotFound);
    await reserveAttachment("alice",base.id,"20000000-0000-4000-8000-000000000002","Chart");
    await reserveAttachment("alice",base.id,"20000000-0000-4000-8000-000000000003","Chart");
    await expect(reserveAttachment("alice",base.id,"20000000-0000-4000-8000-000000000004","Chart")).rejects.toBeInstanceOf(JournalLimit);
    await deleteAttachment("alice",id);await expect(attachmentKey("alice",id)).rejects.toBeInstanceOf(JournalNotFound);
    const queue=await withJournalUser("alice",db=>db.query("select * from alpha_exchange.journal_file_cleanup"));expect(queue.rows).toHaveLength(1);
  });
  it("authenticates and validates the actual HTTP write handler",async()=>{
    const request=(value:unknown,origin="https://www.alphatraders.co.il")=>new NextRequest("https://www.alphatraders.co.il/api/journal/trades",{method:"POST",headers:{origin,"content-type":"application/json","sec-fetch-site":"same-origin"},body:JSON.stringify(value)});
    state.userId="";expect((await POST(request(base)))?.status).toBe(401);state.userId="bob";
    expect((await POST(request({...base,userId:"alice"})))?.status).toBe(400);
    expect((await POST(request(base,"https://evil.test")))?.status).toBe(403);
    const response=await POST(request(base));expect(response?.status).toBe(200);expect(response?.headers.get("cache-control")).toContain("no-store");
    expect((await readJournal("bob")).trades).toHaveLength(1);expect((await readJournal("alice")).trades[0].notes).toBe("Newer saved note");
  });
  it("cascades account data deletion and retains a cleanup queue for private files",async()=>{
    await state.db!.query("delete from alpha_exchange.users where id=$1",["alice"]);
    expect((await readJournal("alice")).trades).toEqual([]);expect((await readJournal("alice")).reviews).toEqual([]);
    expect((await state.db!.query("select * from alpha_exchange.journal_file_cleanup where user_id='alice'")).rows).toHaveLength(3);
  });
});
