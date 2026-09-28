import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useAdminActionDialog } from "./use-admin-action-dialog";
function Harness({ done }: { done: (value: unknown) => void }) {
  const { actionDialog, confirmAction, promptAction } = useAdminActionDialog(false);
  return <>{actionDialog}<button onClick={async () => {
    if (!await confirmAction("Change rank?")) return;
    const reason = await promptAction("Reason", "Owner request"); if (reason) done(reason);
  }}>Start</button></>;
}
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
});
afterEach(cleanup);
it("confirms and collects a reason without browser-native prompts", async () => {
  const done = vi.fn(); render(<Harness done={done} />); fireEvent.click(screen.getByText("Start"));
  fireEvent.click(await screen.findByText("Confirm"));
  fireEvent.change(await screen.findByRole("textbox", { name: "Reason" }), { target: { value: "Verified request" } });
  fireEvent.click(screen.getByText("Confirm"));
  await waitFor(() => expect(done).toHaveBeenCalledWith("Verified request"));
});
it("cancels without invoking the action", async () => {
  const done = vi.fn(); render(<Harness done={done} />); fireEvent.click(screen.getByText("Start"));
  fireEvent.click(await screen.findByText("Cancel")); expect(done).not.toHaveBeenCalled();
});
