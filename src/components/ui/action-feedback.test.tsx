import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_FEEDBACK_REVEALED, ActionFeedback, useActionFeedbackState } from "./action-feedback";

const scroll = vi.fn();
const rect = (top = 350) => ({ top, bottom: top + 40, left: 0, right: 200, width: 200, height: 40, x: 0, y: top, toJSON: () => ({}) });
const flush = () => act(() => { vi.advanceTimersByTime(20); });

beforeEach(() => {
  vi.useFakeTimers();
  scroll.mockClear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.closest("[hidden]") ? [] : [rect()]) as unknown as DOMRectList;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return rect(Number(this.dataset.top ?? 350));
  });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => window.setTimeout(() => fn(0), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("action result navigation", () => {
  it("waits for the result, then reveals and focuses its message", async () => {
    let finish!: (message: string) => void;
    const response = new Promise<string>((resolve) => { finish = resolve; });
    function Action() {
      const [message, setMessage, revision] = useActionFeedbackState<string | null>(null);
      return <><button onClick={async () => setMessage(await response)}>Pause listing</button>
        {message ? <ActionFeedback revealKey={revision}>{message}</ActionFeedback> : null}</>;
    }
    const revealed = vi.fn();
    window.addEventListener(ACTION_FEEDBACK_REVEALED, revealed);
    render(<Action />);
    fireEvent.click(screen.getByRole("button"));
    flush();
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => { finish("Listing paused successfully."); await response; });
    flush();
    expect(document.activeElement).toBe(screen.getByRole("status"));
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center", inline: "nearest" });
    expect(revealed).toHaveBeenCalledOnce();
    window.removeEventListener(ACTION_FEEDBACK_REVEALED, revealed);
  });

  it("reveals identical responses again, without reacting to unrelated rerenders", () => {
    function Action() {
      const [message, setMessage, revision] = useActionFeedbackState("");
      const [draft, setDraft] = useState("");
      return <><button onClick={() => setMessage("Unable to save. Try again.")}>Save</button>
        <input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <ActionFeedback role="alert" revealKey={revision}>{message}</ActionFeedback></>;
    }
    render(<Action />);
    fireEvent.click(screen.getByRole("button")); flush();
    expect(scroll).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "more text" } }); flush();
    expect(scroll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button")); flush();
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(screen.getByRole("alert"));
  });

  it("revisits unchanged form validation on another submission", () => {
    render(<form aria-label="Contact" onSubmit={(event) => event.preventDefault()}>
      <ActionFeedback role="alert">Enter your email.</ActionFeedback><button>Send</button>
    </form>);
    flush(); scroll.mockClear();
    fireEvent.submit(screen.getByRole("form")); flush();
    expect(scroll).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole("alert"));
  });

  it("selects one visible copy closest to the user's viewport", () => {
    render(<><ActionFeedback data-top="1800">Listing paused.</ActionFeedback>
      <ActionFeedback data-top="350">Listing paused.</ActionFeedback>
      <div hidden><ActionFeedback>Hidden duplicate</ActionFeedback></div></>);
    flush();
    expect(scroll).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getAllByRole("status")[1]);
  });

  it("keeps result focus inside the active dialog", () => {
    render(<><ActionFeedback>Background listing error</ActionFeedback>
      <div role="dialog" aria-label="Remove listing"><ActionFeedback role="alert">Removal failed.</ActionFeedback></div></>);
    flush();
    expect(scroll).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole("alert"));
  });

  it("does not pull users out of a dialog for an unrelated page message", () => {
    render(<><ActionFeedback>Background response</ActionFeedback>
      <div role="dialog" aria-label="Edit listing"><input autoFocus aria-label="Amount" /></div></>);
    flush();
    expect(scroll).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText("Amount"));
  });

  it("places floating action results inside the dialog and survives its closing", () => {
    function Dialog({ open }: { open: boolean }) {
      return <>{open ? <div role="dialog" aria-label="Review"><p>Review listing</p></div> : null}
        <ActionFeedback floating>Review saved.</ActionFeedback></>;
    }
    const view = render(<Dialog open />); flush();
    expect(screen.getByRole("dialog").contains(screen.getByRole("status"))).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("status"));
    view.rerender(<Dialog open={false} />); flush();
    expect(screen.getByRole("status").isConnected).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("status"));
  });

  it("does not reveal empty, background, or removed feedback", () => {
    const view = render(<><ActionFeedback>{""}</ActionFeedback>
      <ActionFeedback autoReveal={false}>Auto saved</ActionFeedback>
      <ActionFeedback>Stale response</ActionFeedback></>);
    view.unmount(); flush();
    expect(scroll).not.toHaveBeenCalled();
    render(<ActionFeedback autoReveal={false}>Updated background status</ActionFeedback>); flush();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("honors reduced-motion preferences", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(<ActionFeedback>Saved.</ActionFeedback>); flush();
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ behavior: "instant" }));
  });
});
