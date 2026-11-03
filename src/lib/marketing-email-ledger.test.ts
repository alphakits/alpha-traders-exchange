// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({pool:null as Pool|null}));
vi.mock("@/lib/postgres-runtime",()=>({getRuntimePostgresPool:()=>mocks.pool}));
import {
  claimMarketingEmail, completeMarketingEmailSend, declineMarketingEmail, failMarketingEmailSend,
  getMarketingEmailAudit, getMarketingEmailStatus, getMarketingUnsubscribeStatus,
  isMarketingEmailClaimEligible, recordMarketingProviderEvent, requestMarketingEmail,
  serializeMarketingEmailPayload, unsubscribeMarketingEmail, type FrozenMarketingPayload,
} from "./marketing-email-ledger";

let db:PGlite;
let tail=Promise.resolve();
async function lock(){const previous=tail;let release!:()=>void;tail=new Promise<void>(resolve=>{release=resolve;});await previous;return release;}
async function query(sql:string,values?:unknown[]){const result=await db.query(sql,values);return {rows:result.rows,rowCount:result.affectedRows??result.rows.length};}
const pool={
  async query(sql:string,values?:unknown[]){const release=await lock();try{return await query(sql,values);}finally{release();}},
  async connect(){return {query,release:await lock()};},
} as unknown as Pool;
const expiry=()=>new Date(Date.now()+7*24*60*60*1000).toISOString();
const identity=()=>({campaignId:"mentorship-test",userId:"buyer-a",email:"buyer@example.com",offerExpiresAt:expiry()});
const frozen=(token:string):FrozenMarketingPayload=>({from:"Alpha <notifications@example.com>",to:"buyer@example.com",subject:"Requested invitation",html:`<a href="https://example.com/unsubscribe?token=${token}">Unsubscribe</a>`,text:"Your requested mentorship details",headers:{"Z-Test":"z","A-Test":"a"}});
const request=(overrides:Partial<Parameters<typeof requestMarketingEmail>[0]>={})=>requestMarketingEmail({...identity(),locale:"en",consentVersion:"one-time-v1",consentText:"Email this one invitation to my verified account address.",buildPayload:({unsubscribeToken})=>frozen(unsubscribeToken),...overrides});
const rows=()=>db.query<{id:string;request_body:FrozenMarketingPayload;request_body_hash:string;unsubscribe_token:string;idempotency_key:string;delivery_status:string;consent_status:string;first_attempt_at:string;retry_until:string}>("select * from alpha_exchange.marketing_email_requests order by created_at");

beforeAll(async()=>{
  db=await PGlite.create();
  await db.exec(`create schema alpha_exchange;
    create table alpha_exchange.users(id text primary key,email text not null,payload jsonb not null);
    create table alpha_exchange.activity_logs(id text primary key,user_id text,category text,created_at timestamptz,payload jsonb);
    create table public.contact_submissions(id text primary key,email text,subject text,message text);
    create role campaign_browser; grant usage on schema alpha_exchange to campaign_browser;`);
  await db.exec(await readFile("supabase/migrations/20261103152629_marketing_one_time_email_ledger.sql","utf8"));
},20_000);
beforeEach(async()=>{
  mocks.pool=pool;
  await db.exec(`truncate alpha_exchange.marketing_email_events,alpha_exchange.marketing_email_requests,alpha_exchange.users,alpha_exchange.activity_logs,public.contact_submissions;
    insert into alpha_exchange.users values('buyer-a','buyer@example.com','{"emailVerified":true,"notificationPreferences":{"email":false}}'),('buyer-b','second@example.com','{"emailVerified":false}');`);
});
afterAll(async()=>{await db.close();});

describe("one-time campaign consent and immutable delivery",()=>{
  it("rejects recipient substitution and unverified identities before writing",async()=>{
    expect(await request({email:"attacker@example.com"})).toMatchObject({status:"held",canRequest:false});
    expect(await request({userId:"buyer-b",email:"second@example.com"})).toMatchObject({status:"unverified",canRequest:false});
    expect((await rows()).rows).toHaveLength(0);
  });

  it("deduplicates concurrent clicks and freezes one payload, token and consent record",async()=>{
    const build=vi.fn(({unsubscribeToken}:{unsubscribeToken:string})=>frozen(unsubscribeToken));
    const results=await Promise.all(Array.from({length:8},()=>request({buildPayload:build})));
    expect(results.every(result=>result.status==="queued")).toBe(true);
    expect(build).toHaveBeenCalledTimes(1);
    const record=(await rows()).rows[0];
    expect((await rows()).rows).toHaveLength(1);
    expect(record.request_body_hash).toBe(createHash("sha256").update(serializeMarketingEmailPayload(record.request_body)).digest("hex"));
    expect((await db.query("select * from alpha_exchange.marketing_email_events where event_type='consent_requested'")).rows).toHaveLength(1);
    await expect(db.query("update alpha_exchange.marketing_email_requests set request_body=$1::jsonb where id=$2",[JSON.stringify({...record.request_body,subject:"Changed after acceptance"}),record.id])).rejects.toThrow(/immutable/);
    expect((await db.query<{payload:{notificationPreferences:{email:boolean}}}>("select payload from alpha_exchange.users where id='buyer-a'")).rows[0].payload.notificationPreferences.email).toBe(false);
  });

  it("preserves imported holds and delivered history instead of re-enrolling them",async()=>{
    await db.query(`insert into alpha_exchange.marketing_email_requests(id,campaign_id,user_id,email,idempotency_key,offer_expires_at,hold_codes,delivery_status)
      values('00000000-0000-4000-8000-000000000001','mentorship-test','buyer-a','buyer@example.com','seeded', $1,ARRAY['provider_bounce'],'held')`,[expiry()]);
    const build=vi.fn(()=>frozen("unused"));
    expect(await request({buildPayload:build})).toMatchObject({status:"held",holdCodes:["provider_bounce"]});
    expect(build).not.toHaveBeenCalled();
    await db.exec("update alpha_exchange.marketing_email_requests set hold_codes='{}',delivery_status='delivered',consent_status='legacy_newsletter',provider_campaign_id='existing-provider-campaign'");
    expect(await request({buildPayload:build})).toMatchObject({status:"delivered",canRequest:false});
    expect(build).not.toHaveBeenCalled();
    expect(await claimMarketingEmail()).toBeNull();
  });

  it("fences competing leases and retries with the same frozen provider request",async()=>{
    await request();
    const first=(await claimMarketingEmail())!;
    expect(first).not.toBeNull();
    expect(await claimMarketingEmail()).toBeNull();
    await failMarketingEmailSend({requestId:first.id,leaseToken:first.leaseToken,reason:"network_timeout",retryable:true,ambiguous:true});
    await db.exec("update alpha_exchange.marketing_email_requests set available_at=now()-interval '1 second'");
    const next=(await claimMarketingEmail())!;
    expect(next.idempotencyKey).toBe(first.idempotencyKey);
    expect(next.requestBody).toEqual(first.requestBody);
    expect(next.payloadHash).toBe(first.payloadHash);
    expect(next.firstAttemptAt).toBe(first.firstAttemptAt);
    expect(next.retryUntil).toBe(first.retryUntil);
    expect(await completeMarketingEmailSend({requestId:first.id,leaseToken:first.leaseToken,providerEmailId:"stale"})).toBe(false);
    expect(await completeMarketingEmailSend({requestId:next.id,leaseToken:next.leaseToken,providerEmailId:"provider-1"})).toBe(true);
    expect((await db.query<{provider_outcome_unknown:boolean}>("select provider_outcome_unknown from alpha_exchange.marketing_email_requests")).rows[0].provider_outcome_unknown).toBe(false);
    expect(await claimMarketingEmail()).toBeNull();
  });

  it("preserves an earlier unknown provider outcome through later preflight retry exhaustion",async()=>{
    await request();
    const first=(await claimMarketingEmail())!;
    await failMarketingEmailSend({requestId:first.id,leaseToken:first.leaseToken,reason:"post_timeout",retryable:true,ambiguous:true});
    await db.exec("update alpha_exchange.marketing_email_requests set attempts=31,available_at=now()-interval '1 second'");
    const last=(await claimMarketingEmail())!;
    expect(last.attempts).toBe(32);
    await failMarketingEmailSend({requestId:last.id,leaseToken:last.leaseToken,reason:"preflight_unavailable",retryable:true,ambiguous:false});
    const record=(await db.query<{delivery_status:string;provider_outcome_unknown:boolean}>("select delivery_status,provider_outcome_unknown from alpha_exchange.marketing_email_requests")).rows[0];
    expect(record).toEqual({delivery_status:"uncertain",provider_outcome_unknown:true});
    expect(await claimMarketingEmail()).toBeNull();
    expect(await request()).toMatchObject({status:"uncertain",canRequest:false});
  });

  it("parks an ambiguous old attempt instead of sending outside the provider window",async()=>{
    await request();
    await db.exec(`update alpha_exchange.marketing_email_requests set delivery_status='sending',attempts=1,
      first_attempt_at=now()-interval '25 hours',retry_until=now()-interval '2 hours',lease_until=now()-interval '1 hour'`);
    expect(await claimMarketingEmail()).toBeNull();
    expect((await rows()).rows[0].delivery_status).toBe("uncertain");
    expect(await request()).toMatchObject({status:"uncertain",canRequest:false});
  });

  it("refuses expired offers and stops a queued request when the offer expires",async()=>{
    expect(await request({offerExpiresAt:new Date(Date.now()-1000).toISOString()})).toMatchObject({status:"expired"});
    expect((await rows()).rows).toHaveLength(0);
    await request();
    await db.exec("update alpha_exchange.marketing_email_requests set offer_expires_at=now()-interval '1 second'");
    expect(await claimMarketingEmail()).toBeNull();
    expect((await rows()).rows[0].delivery_status).toBe("expired");
  });

  it("honors new explicit email opt-outs while allowing default false beforehand",async()=>{
    expect(await request()).toMatchObject({status:"queued"});
    await db.exec(`insert into alpha_exchange.activity_logs values('off','buyer-a','account',now(),'{"title":"Notification preferences updated","details":"inApp=true, email=false, sms=false"}')`);
    expect(await claimMarketingEmail()).toBeNull();
    expect(await getMarketingEmailStatus(identity())).toMatchObject({status:"held",holdCodes:["explicit_email_optout"]});
    expect(await request()).toMatchObject({status:"held"});
  });

  it("rechecks deletion requests and changed account ownership before transport",async()=>{
    await request();
    const job=(await claimMarketingEmail())!;
    expect(await isMarketingEmailClaimEligible({requestId:job.id,leaseToken:job.leaseToken})).toBe(true);
    await db.exec(`insert into public.contact_submissions values('delete','buyer@example.com','Alpha Traders account deletion request','Please delete my account')`);
    expect(await isMarketingEmailClaimEligible({requestId:job.id,leaseToken:job.leaseToken})).toBe(false);
    await db.exec("delete from public.contact_submissions;update alpha_exchange.users set email='changed@example.com' where id='buyer-a'");
    expect(await isMarketingEmailClaimEligible({requestId:job.id,leaseToken:job.leaseToken})).toBe(false);
  });

  it.each(["request","queued","claimed"] as const)("honors the Arabic account-deletion form at the %s stage",async(stage)=>{
    if(stage!=="request") await request();
    const job=stage==="claimed" ? (await claimMarketingEmail())! : null;
    // Exact Arabic defaults from app/[locale]/account-deletion/page.tsx, stored by /api/contact.
    await db.query("insert into public.contact_submissions values($1,$2,$3,$4)",[
      "arabic-delete","buyer@example.com","طلب حذف حساب Alpha Traders",
      "أطلب حذف حساب Alpha Traders المرتبط بالبريد الإلكتروني المذكور أعلاه والبيانات المرتبطة به.",
    ]);
    expect(await getMarketingEmailStatus(identity())).toMatchObject({status:"held",canRequest:false,holdCodes:["deletion_or_optout_requested"]});
    expect(await request()).toMatchObject({status:"held",canRequest:false});
    if(stage==="request") expect((await rows()).rows).toHaveLength(0);
    else if(stage==="queued") expect(await claimMarketingEmail()).toBeNull();
    else expect(await isMarketingEmailClaimEligible({requestId:job!.id,leaseToken:job!.leaseToken})).toBe(false);
  });

  it("withdraws by opaque token without exposing identity and blocks other campaigns",async()=>{
    await request();
    const token=(await rows()).rows[0].unsubscribe_token;
    const job=(await claimMarketingEmail())!;
    expect(await getMarketingUnsubscribeStatus(token)).toEqual({valid:true,unsubscribed:false,campaignId:"mentorship-test"});
    expect(await unsubscribeMarketingEmail(token)).toBe(true);
    expect(await unsubscribeMarketingEmail(token)).toBe(true);
    expect(await isMarketingEmailClaimEligible({requestId:job.id,leaseToken:job.leaseToken})).toBe(false);
    expect(await request({campaignId:"another-campaign"})).toMatchObject({status:"unsubscribed",canRequest:false});
    expect((await rows()).rows).toHaveLength(1);
    expect((await db.query("select * from alpha_exchange.marketing_email_events where event_type='unsubscribed'")).rows).toHaveLength(1);
    expect(await getMarketingUnsubscribeStatus("invalid")).toEqual({valid:false,unsubscribed:false});
  });

  it("cancels accepted consent on decline without changing frozen content",async()=>{
    await request();
    const before=(await rows()).rows[0];
    await declineMarketingEmail(identity());
    expect((await rows()).rows[0].delivery_status).toBe("cancelled");
    expect(await claimMarketingEmail()).toBeNull();
    expect(await request()).toMatchObject({status:"declined",canRequest:false});
    expect((await rows()).rows[0].request_body).toEqual(before.request_body);
  });

  it("rejects missing consent source in the database check, even with every other field present",async()=>{
    await request();
    await expect(db.exec(`insert into alpha_exchange.marketing_email_requests
      (id,campaign_id,user_id,email,idempotency_key,offer_expires_at,consent_status,consent_version,consent_text,consent_hash,accepted_at,request_body,request_body_hash,unsubscribe_token,unsubscribe_token_hash)
      select '00000000-0000-4000-8000-000000000099','missing-source',user_id,email,'missing-source-key',offer_expires_at,
        'requested',consent_version,consent_text,consent_hash,accepted_at,request_body,request_body_hash,'different-token',repeat('1',64)
      from alpha_exchange.marketing_email_requests limit 1`)).rejects.toThrow(/marketing_requested_consent_evidence/);
  });

  it("retains an in-flight provider receipt when withdrawal races with completion",async()=>{
    await request();
    const record=(await rows()).rows[0];
    const job=(await claimMarketingEmail())!;
    await unsubscribeMarketingEmail(record.unsubscribe_token);
    expect((await rows()).rows[0].delivery_status).toBe("sending");
    expect(await completeMarketingEmailSend({requestId:job.id,leaseToken:job.leaseToken,providerEmailId:"inflight-receipt"})).toBe(true);
    expect(await getMarketingEmailStatus(identity())).toMatchObject({status:"unsubscribed",canRequest:false});
    expect((await db.query<{provider_email_id:string}>("select provider_email_id from alpha_exchange.marketing_email_requests")).rows[0].provider_email_id).toBe("inflight-receipt");
  });

  it("distinguishes polling observations from actual provider event times and deduplicates",async()=>{
    await request();
    const job=(await claimMarketingEmail())!;
    await completeMarketingEmailSend({requestId:job.id,leaseToken:job.leaseToken,providerEmailId:"provider-1"});
    const poll={providerEventId:"poll-delivered-1",providerEmailId:"provider-1",type:"delivered" as const,source:"poll" as const,observedAt:new Date().toISOString()};
    expect(await recordMarketingProviderEvent(poll)).toBe(true);
    expect(await recordMarketingProviderEvent(poll)).toBe(false);
    const observed=(await db.query<{delivery_status:string;delivered_at:string|null}>("select delivery_status,delivered_at from alpha_exchange.marketing_email_requests")).rows[0];
    expect(observed).toEqual({delivery_status:"delivered",delivered_at:null});
    const event=(await db.query<{occurred_at:null;observed_at:string}>("select occurred_at,observed_at from alpha_exchange.marketing_email_events where source='poll'")).rows[0];
    expect(event.occurred_at).toBeNull();
    expect(event.observed_at).toBeTruthy();
    const actual=new Date(Date.now()-1000).toISOString();
    await recordMarketingProviderEvent({providerEventId:"webhook-1",providerEmailId:"provider-1",type:"delivered",occurredAt:actual,source:"webhook"});
    expect(new Date((await db.query<{delivered_at:string}>("select delivered_at from alpha_exchange.marketing_email_requests")).rows[0].delivered_at).toISOString()).toBe(actual);
    const audit=await getMarketingEmailAudit("mentorship-test");
    expect(audit.recipients[0].events.some(e=>e.source==="poll"&&e.occurredAt===null&&e.observedAt)).toBe(true);
    expect(JSON.stringify(audit)).not.toContain((await rows()).rows[0].unsubscribe_token);
    expect(JSON.stringify(audit)).not.toContain("request_body");
  });

  it("keeps campaign tables inaccessible to browser roles even with accidental SELECT grants",async()=>{
    await request();
    await db.exec("grant select on alpha_exchange.marketing_email_requests,alpha_exchange.marketing_email_events to campaign_browser;set role campaign_browser");
    try {
      expect((await db.query("select * from alpha_exchange.marketing_email_requests")).rows).toHaveLength(0);
      expect((await db.query("select * from alpha_exchange.marketing_email_events")).rows).toHaveLength(0);
    } finally {await db.exec("reset role");}
  });
});
