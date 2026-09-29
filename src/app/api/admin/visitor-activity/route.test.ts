// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ auth:vi.fn(),start:vi.fn(),directory:vi.fn(),timeline:vi.fn() }));
vi.mock("@/lib/api-auth",()=>({requireApiOwner:mocks.auth}));
vi.mock("@/lib/owner-analytics-period-store",()=>({readOwnerAnalyticsStart:mocks.start}));
vi.mock("@/lib/owner-visitor-activity-store",()=>({readOwnerVisitorDirectory:mocks.directory,readOwnerVisitorTimeline:mocks.timeline,
  parseVisitorCursor:(cursor?:string)=>{ if (cursor === "bad") throw Error("bad"); return null; }}));
import { GET } from "./route";
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({user:{id:"owner"}});mocks.start.mockResolvedValue("2026-09-28T21:05:12.333014Z");mocks.directory.mockResolvedValue({visitors:[],nextCursor:null});mocks.timeline.mockResolvedValue({events:[],nextCursor:null});});
const request = (query="") => new NextRequest(`https://example.test/api/admin/visitor-activity${query}`);
describe("private visitor activity authorization",()=>{
  for (const status of [401,403,503]) it(`does not read any activity on owner-guard ${status}`,async()=>{
    mocks.auth.mockResolvedValue({user:null,unauthorized:NextResponse.json({error:"denied"},{status})});
    const response=await GET(request("?person=user:alice"));
    expect(response.status).toBe(status);expect(mocks.start).not.toHaveBeenCalled();expect(mocks.timeline).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });
  it("uses the durable reporting start and explicit owner-selected person",async()=>{
    expect((await GET(request("?period=today&person=user:alice"))).status).toBe(200);
    expect(mocks.timeline).toHaveBeenCalledWith("2026-09-28T21:05:12.333014Z","today","user:alice",undefined);
  });
  it("rejects malformed filters and cursors without a data read",async()=>{
    for(const query of ["?period=all-time","?person=alice","?cursor=bad","?userId=alice"]) expect((await GET(request(query))).status).toBe(400);
    expect(mocks.directory).not.toHaveBeenCalled();expect(mocks.timeline).not.toHaveBeenCalled();
  });
  it("does not expose database failures or manufacture empty success",async()=>{
    mocks.directory.mockRejectedValue(Error("SECRET_DATABASE"));const response=await GET(request());
    expect(response.status).toBe(503);expect(await response.text()).not.toContain("SECRET_DATABASE");
  });
});
