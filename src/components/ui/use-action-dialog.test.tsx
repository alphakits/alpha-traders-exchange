import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useActionDialog } from "./use-action-dialog";

function Harness({ done, isArabic = false, mode = "confirm", scope }: {
  done: (answer: unknown) => void;
  isArabic?: boolean;
  mode?: "confirm" | "sequence" | "duplicate";
  scope?: string;
}) {
  const { actionDialog, confirmAction, promptAction } = useActionDialog(isArabic, scope);
  return <>{actionDialog}<button onClick={async () => {
    const question = isArabic ? "هل تريد قبول الصفقة؟" : "Accept this trade?";
    if (mode === "duplicate") {
      const first = confirmAction(question);
      const second = confirmAction("A second request must not replace the first.");
      done(await Promise.all([first, second]));
      return;
    }
    const confirmed = await confirmAction(question);
    if (mode === "sequence" && confirmed) {
      done(await promptAction("Reason", "Owner request"));
    } else done(confirmed);
  }}>Start</button></>;
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.open = true; }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.open = false; }),
  });
  vi.spyOn(window, "confirm").mockImplementation(() => { throw new Error("Native confirmations are unavailable."); });
  vi.spyOn(window, "prompt").mockImplementation(() => { throw new Error("Native prompts are unavailable."); });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("requires an in-page confirmation when browser-native prompts are unavailable", async () => {
  const done = vi.fn();
  render(<Harness done={done} />);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  const dialog = await screen.findByRole("dialog", { name: "Accept this trade?" });
  expect(done).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(done).toHaveBeenCalledExactlyOnceWith(true));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(window.confirm).not.toHaveBeenCalled();
  expect(window.prompt).not.toHaveBeenCalled();
});

it("supports a confirmation followed by an editable prompt without losing the second question", async () => {
  const done = vi.fn();
  render(<Harness done={done} mode="sequence" />);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  const prompt = await screen.findByRole("textbox", { name: "Reason" });
  expect((prompt as HTMLInputElement).value).toBe("Owner request");
  fireEvent.change(prompt, { target: { value: "Verified request" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(done).toHaveBeenCalledExactlyOnceWith("Verified request"));
  expect(window.confirm).not.toHaveBeenCalled();
  expect(window.prompt).not.toHaveBeenCalled();
});

it("ignores a delayed close event from the first dialog while the next question is being opened", async () => {
  const done = vi.fn();
  let dispatchPreviousClose = () => {};
  vi.mocked(HTMLDialogElement.prototype.close).mockImplementation(function (this: HTMLDialogElement) {
    this.open = false;
    dispatchPreviousClose = () => this.dispatchEvent(new Event("close"));
  });
  render(<Harness done={done} mode="sequence" />);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  const confirm = await screen.findByRole("button", { name: "Confirm" });
  await act(async () => {
    fireEvent.click(confirm);
    // Resolve both async awaits while React is still batching the next dialog.
    await Promise.resolve();
    await Promise.resolve();
    dispatchPreviousClose();
  });
  const prompt = await screen.findByRole("textbox", { name: "Reason" });
  expect(done).not.toHaveBeenCalled();
  fireEvent.change(prompt, { target: { value: "Still awaiting confirmation" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(done).toHaveBeenCalledExactlyOnceWith("Still awaiting confirmation"));
});

it("cancels without approving the action and restores focus to its trigger", async () => {
  const done = vi.fn();
  render(<Harness done={done} />);
  const trigger = screen.getByRole("button", { name: "Start" });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(done).toHaveBeenCalledExactlyOnceWith(false));
  expect(document.activeElement).toBe(trigger);
});

it("treats Escape dismissal as cancellation", async () => {
  const done = vi.fn();
  render(<Harness done={done} />);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(done).toHaveBeenCalledExactlyOnceWith(false));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("cancels when the active dialog is closed by the browser", async () => {
  const done = vi.fn();
  render(<Harness done={done} />);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  const dialog = await screen.findByRole("dialog") as HTMLDialogElement;
  dialog.open = false;
  fireEvent(dialog, new Event("close"));
  await waitFor(() => expect(done).toHaveBeenCalledExactlyOnceWith(false));
});

it("settles a pending confirmation as cancelled when its page unmounts", async () => {
  const done = vi.fn();
  const { unmount } = render(<Harness done={done} />);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByRole("dialog");
  unmount();
  await waitFor(() => expect(done).toHaveBeenCalledExactlyOnceWith(false));
});

it("cancels consent when the session scope changes and allows a fresh confirmation", async () => {
  const done = vi.fn();
  const { rerender } = render(<Harness done={done} scope="seller-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByRole("dialog");
  rerender(<Harness done={done} scope="seller-2" />);
  await waitFor(() => expect(done).toHaveBeenCalledExactlyOnceWith(false));
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(done).toHaveBeenNthCalledWith(2, true));
  expect(done).toHaveBeenCalledTimes(2);
});

it("rejects a duplicate question while keeping the original confirmation usable", async () => {
  const done = vi.fn();
  render(<Harness done={done} mode="duplicate" />);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  const dialog = await screen.findByRole("dialog", { name: "Accept this trade?" });
  expect(screen.queryByText("A second request must not replace the first.")).toBeNull();
  expect(done).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(done).toHaveBeenCalledExactlyOnceWith([true, false]));
});

it("renders an Arabic confirmation with Arabic controls and right-to-left direction", async () => {
  const done = vi.fn();
  render(<Harness done={done} isArabic />);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  const dialog = await screen.findByRole("dialog", { name: "هل تريد قبول الصفقة؟" });
  expect(dialog.getAttribute("dir")).toBe("rtl");
  expect(within(dialog).getByRole("button", { name: "إلغاء" })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد" }));
  await waitFor(() => expect(done).toHaveBeenCalledExactlyOnceWith(true));
});

it("fails closed with a visible explanation if the page dialog cannot open", async () => {
  vi.mocked(HTMLDialogElement.prototype.showModal).mockImplementation(() => { throw new Error("Dialog unavailable"); });
  const done = vi.fn();
  render(<Harness done={done} />);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await waitFor(() => expect(done).toHaveBeenCalledExactlyOnceWith(false));
  expect((await screen.findByRole("alert")).textContent).toContain("No action was taken.");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(window.confirm).not.toHaveBeenCalled();
});
