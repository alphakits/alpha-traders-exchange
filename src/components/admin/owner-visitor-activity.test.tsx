import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OwnerVisitorActivity } from "./owner-visitor-activity";
const person = { key:"user:alice",accountId:"AT-123456",name:"Alice Example",role:"buyer",firstSeen:"2026-09-29T00:00:00Z",lastSeen:"2026-09-29T00:05:00Z",pages:1,visits:7,sessions:7,platforms:["ios"],lastPath:"/en/prop-firms" };
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("private person journey UI",()=>{
  it("reads only when expanded and opens a separate timeline for the chosen account",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({visitors:[person],nextCursor:null}))
      .mockResolvedValueOnce(Response.json({events:[{id:"page:1",at:person.lastSeen,kind:"page",label:"/en/prop-firms",platform:"ios"}],nextCursor:null}));
    vi.stubGlobal("fetch",fetcher);
    render(<OwnerVisitorActivity period="all" locale="en" revision={null}/>);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:/People & activity/}));
    fireEvent.click(await screen.findByRole("button",{name:/AT-123456/}));
    expect(await screen.findByText("Visited Prop Firms")).toBeTruthy();
    expect(fetcher.mock.calls[1][0]).toContain("person=user%3Aalice");
    fireEvent.click(screen.getByRole("button",{name:/People & activity/}));
    expect(screen.queryByText("Visited Prop Firms")).toBeNull();
  });
  it("clears private people and the selected history if owner access expires",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({visitors:[person],nextCursor:null}))
      .mockResolvedValueOnce(Response.json({error:"Forbidden"},{status:403}));
    vi.stubGlobal("fetch",fetcher);
    render(<OwnerVisitorActivity period="today" locale="en" revision={null}/>);
    fireEvent.click(screen.getByRole("button",{name:/People & activity/}));
    await screen.findByRole("button",{name:/AT-123456/});
    fireEvent.click(screen.getByRole("button",{name:"Refresh people"}));
    await waitFor(()=>expect(screen.queryByRole("button",{name:/AT-123456/})).toBeNull());
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
