import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: { user: { id: "user-one", email: "one@example.test", emailVerified: true }, isResolving: false, error: false } as { user: { id: string; email: string; emailVerified: boolean } | null; isResolving: boolean; error: boolean } | null, enabled: true }));
vi.mock("@/components/auth/canonical-session-provider", () => ({ useOptionalCanonicalSession: () => session.current }));
vi.mock("@/lib/mentorship-email-config", () => ({ isMentorshipEmailRequestEnabled: () => session.enabled }));
import { MentorshipEmailRequest } from "./mentorship-email-request";

const available = { status: "available", canRequest: true, maskedEmail: "o•••@example.test", consentVersion: "invitation-test-v1", consentText: "I request one promotional email about the paid ICT mentorship invitation." };
const response = (state: Record<string, unknown> = available, status = 200) => new Response(JSON.stringify(state), { status });
beforeEach(() => {
  session.current = { user: { id: "user-one", email: "one@example.test", emailVerified: true }, isResolving: false, error: false };
  session.enabled = true;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("does not ask anonymous visitors for consent or read account status", () => {
  session.current = null;
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const view = render(<MentorshipEmailRequest locale="en" compact />);
  expect(view.container.firstChild).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it("waits for an explicit open, then requires unchecked consent before one request", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ ...available, status: "queued", canRequest: false }, 202));
  vi.stubGlobal("fetch", fetcher);
  render(<MentorshipEmailRequest locale="en" compact />);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Email me this invitation" }));
  const checkbox = await screen.findByRole("checkbox") as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  expect((screen.getByRole("button", { name: "Send me the invitation" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(checkbox);
  const submit = screen.getByRole("button", { name: "Send me the invitation" });
  fireEvent.click(submit); fireEvent.click(submit);
  await screen.findByText("Your request is saved. We will send one invitation once the delivery checks pass.");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json", "x-alpha-expected-user-id": "user-one" } });
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ action: "request", locale: "en", consentVersion: "invitation-test-v1", consent: true });
  expect(screen.queryByText(/mail provider accepted/)).toBeNull();
});

it("lets a user decline without checking consent or changing other preferences", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ ...available, status: "declined", canRequest: false }));
  vi.stubGlobal("fetch", fetcher);
  render(<MentorshipEmailRequest locale="en" />);
  fireEvent.click(await screen.findByRole("button", { name: "No email, thanks" }));
  await screen.findByText("No invitation email requested.");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ action: "decline", locale: "en" });
  expect(fetcher.mock.calls.every(([url]) => String(url).startsWith("/api/marketing/mentorship-invitation"))).toBe(true);
});

it.each(["held", "unsubscribed", "delivered", "expired"])("offers no send or override control for %s status", async status => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...available, status, canRequest: false })));
  render(<MentorshipEmailRequest locale="en" />);
  await waitFor(() => expect(screen.queryByText("Checking request status…")).toBeNull());
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "Send me the invitation" })).toBeNull();
});

it("requires a status read after an uncertain mutation before it permits another choice", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error("network failed")).mockResolvedValueOnce(response({ ...available, status: "queued", canRequest: false }));
  vi.stubGlobal("fetch", fetcher);
  render(<MentorshipEmailRequest locale="en" />);
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Send me the invitation" }));
  await screen.findByRole("alert");
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check request status" }));
  await screen.findByText("Your request is saved. We will send one invitation once the delivery checks pass.");
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});

it("discards a stale account read when a different account signs in", async () => {
  let finishOld!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; })).mockResolvedValueOnce(response({ ...available, maskedEmail: "t•••@example.test" }));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<MentorshipEmailRequest locale="en" />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  session.current = { user: { id: "user-two", email: "two@example.test", emailVerified: true }, isResolving: false, error: false };
  view.rerender(<MentorshipEmailRequest locale="en" />);
  await screen.findByText("t•••@example.test");
  await act(async () => { finishOld(response()); });
  expect(screen.queryByText("o•••@example.test")).toBeNull();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect(fetcher.mock.calls[1][1].headers["x-alpha-expected-user-id"]).toBe("user-two");
});

it("uses the server-provided Arabic consent text without preselecting it", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...available, consentText: "أطلب رسالة ترويجية واحدة عن المنتورشيب." })));
  const view = render(<MentorshipEmailRequest locale="ar" />);
  const checkbox = await screen.findByRole("checkbox", { name: "أطلب رسالة ترويجية واحدة عن المنتورشيب." }) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  expect(view.container.querySelector('[dir="rtl"]')).toBeTruthy();
});
