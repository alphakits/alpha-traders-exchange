// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
const state = vi.hoisted(() => ({ db: null as unknown as PGlite }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => ({
  query: async (sql: string, params?: unknown[]) => {
    const result = params ? await state.db.query(sql,params) : (await state.db.exec(sql)).at(-1)!;
    return { ...result,rowCount: result.affectedRows };
  },
}) }));
import { readOwnerTrafficAnalytics, recordTrafficEvent } from "./traffic-analytics-store";
import { parseVisitorCursor, readOwnerVisitorDirectory, readOwnerVisitorTimeline } from "./owner-visitor-activity-store";
const start = "2000-01-01T00:00:00Z";
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(`create schema alpha_exchange;
    create table alpha_exchange.users(id text primary key,role text,payload jsonb);
    create table alpha_exchange.audit_logs(id text primary key,actor_user_id text,target_user_id text,created_at timestamptz,action text,payload jsonb);
    insert into alpha_exchange.users values ('alice','buyer','{"fullName":"Alice Example","passwordHash":"SECRET_HASH","whatsappNumber":"SECRET_PHONE"}');`);
  await readOwnerTrafficAnalytics();
},30_000);
beforeEach(async () => { await state.db.exec("truncate alpha_exchange.traffic_events,alpha_exchange.audit_logs"); });
afterAll(async () => { await state.db?.close(); });
const visit = (userId: string | null = "alice",visitorKey = "browser",sessionKey = "open",path = "/en/prop-firms") => recordTrafficEvent({userId,visitorKey,sessionKey,path,eventName:"page_view",platform:"ios",deviceType:"mobile"});

describe("owner visitor directory and journey", () => {
  it("returns one named person across app reopenings and linked guest visits without secrets", async () => {
    await visit(null); await visit(); await visit("alice","second-device","open-2");
    const result = await readOwnerVisitorDirectory(start,"all");
    expect(result.visitors).toHaveLength(1);
    expect(result.visitors[0]).toMatchObject({key:"user:alice",name:"Alice Example",visits:3,pages:1,sessions:2,platforms:["ios"]});
    expect(result.visitors[0].accountId).toMatch(/^AT-\d+$/);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(JSON.stringify(result)).not.toContain("passwordHash");
  });
  it("preserves shared-browser identities and does not invent a guest name", async () => {
    await visit(); await visit("bob"); await visit(null);
    const result = await readOwnerVisitorDirectory(start,"all");
    expect(result.visitors).toHaveLength(3);
    expect(result.visitors.find(person => person.key==="visitor:browser")).toMatchObject({accountId:null,name:null});
  });
  it("counts language changes and trailing slashes as the same visited page",async()=>{
    for (const path of ["/en/prop-firms","/ar/prop-firms/","/prop-firms?x=1#top"]) await visit("alice","browser","open",path);
    expect((await readOwnerVisitorDirectory(start,"all")).visitors[0]).toMatchObject({pages:1,visits:3});
  });
  it("shows the actor's recorded actions, never another actor's action on the target", async () => {
    await visit();
    await state.db.exec(`insert into alpha_exchange.audit_logs values
      ('own','alice','bob',now(),'listing_created','{"details":"SECRET_BANK"}'),
      ('other','bob','alice',now(),'seller_approved','{}');`);
    const timeline = await readOwnerVisitorTimeline(start,"all","user:alice");
    expect(timeline.events.map(event => event.label)).toContain("listing_created");
    expect(timeline.events.map(event => event.label)).not.toContain("seller_approved");
    expect(timeline.events.filter(event => event.kind==="page")).toHaveLength(1);
    expect(JSON.stringify(timeline)).not.toContain("SECRET_BANK");
    expect((await readOwnerVisitorTimeline(start,"all","visitor:unrelated")).events).toEqual([]);
  });
  it("filters both pages and actions at the reporting start and Israel midnight", async () => {
    await visit();
    await state.db.exec("update alpha_exchange.traffic_events set occurred_at=date_trunc('day',now(),'Asia/Jerusalem')-interval '1 second'");
    await state.db.exec("insert into alpha_exchange.audit_logs values ('old','alice',null,'1999-01-01','listing_created','{}')");
    expect((await readOwnerVisitorDirectory(start,"today")).visitors).toEqual([]);
    expect((await readOwnerVisitorDirectory(start,"all")).visitors).toHaveLength(1);
    expect((await readOwnerVisitorTimeline(start,"today","user:alice")).events).toEqual([]);
    const futureStart = new Date(Date.now()+60_000).toISOString();
    expect((await readOwnerVisitorDirectory(futureStart,"all")).visitors).toEqual([]);
  });
  it("paginates people and events with microsecond timestamps without omissions or duplicates", async () => {
    for (let index=0;index<31;index++) await visit(`person-${index}`,`browser-${index}`);
    const first = await readOwnerVisitorDirectory(start,"all");
    expect(first.visitors).toHaveLength(25);
    const second = await readOwnerVisitorDirectory(start,"all",first.nextCursor);
    expect(second.visitors).toHaveLength(6);
    expect(new Set([...first.visitors,...second.visitors].map(person=>person.key)).size).toBe(31);
    for (let index=0;index<61;index++) await state.db.query("insert into alpha_exchange.audit_logs values ($1,'alice',null,'2026-01-01T00:00:00.123456Z','listing_created','{}')",[`event-${String(index).padStart(3,"0")}`]);
    const page = await readOwnerVisitorTimeline(start,"all","user:alice");
    expect(page.events).toHaveLength(50);
    expect(parseVisitorCursor(page.nextCursor)?.at).toContain("123456");
    const next = await readOwnerVisitorTimeline(start,"all","user:alice",page.nextCursor);
    expect(next.events).toHaveLength(11);
    expect(new Set([...page.events,...next.events].map(event=>event.id)).size).toBe(61);
    expect(next.nextCursor).toBeNull();
  });
  it("rejects invalid cursors before reading data", () => {
    for (const value of ["not-json","%",Buffer.from('{"at":"bad","key":"a"}').toString("base64url")]) expect(()=>parseVisitorCursor(value)).toThrow("Invalid cursor");
  });
});
