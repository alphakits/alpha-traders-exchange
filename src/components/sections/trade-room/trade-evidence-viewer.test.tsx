import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradeEvidenceViewer } from "./trade-evidence-viewer";

const evidence = { id: "receipt/1", fileName: "payment-receipt.jpg", mimeType: "image/jpeg" } as const;
const source = "/api/alpha-exchange/purchase-requests/trade%2F1/evidence/receipt%2F1";

beforeEach(() => {
  // jsdom has no modal implementation; real browser coverage verifies the top layer and focus trap.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = true; }) });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = false; }) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.body.style.overflow = ""; });

describe("trade evidence viewer", () => {
  it("opens the private image in a modal and restores focus and scroll when Close is pressed", () => {
    document.body.style.overflow = "auto";
    render(<TradeEvidenceViewer requestId="trade/1" evidence={evidence} isAr={false} />);
    expect(screen.queryByRole("img")).toBeNull();
    const trigger = screen.getByRole("button", { name: evidence.fileName });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: evidence.fileName })).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("src")).toBe(source);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.load(screen.getByRole("img"));
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("auto");
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses on native Escape cancellation and backdrop taps, but keeps image taps open", () => {
    render(<TradeEvidenceViewer requestId="trade/1" evidence={evidence} isAr={false} />);
    const open = () => fireEvent.click(screen.getByRole("button", { name: evidence.fileName }));
    open();
    fireEvent.click(screen.getByRole("img"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Close available while loading and after a failed image, and retries on reopening", () => {
    render(<TradeEvidenceViewer requestId="trade/1" evidence={evidence} isAr={false} />);
    fireEvent.click(screen.getByRole("button", { name: evidence.fileName }));
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("alert").textContent).toContain("could not load");
    expect(screen.getByRole("link", { name: "Download file" }).getAttribute("href")).toBe(source);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: evidence.fileName }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("img")).toBeTruthy();
  });

  it("keeps forward and reverse keyboard navigation on the viewer controls", () => {
    render(<TradeEvidenceViewer requestId="trade/1" evidence={evidence} isAr={false} />);
    fireEvent.click(screen.getByRole("button", { name: evidence.fileName }));
    const close = screen.getByRole("button", { name: "Close" });
    const download = screen.getByRole("link", { name: "Download file" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(download);
    fireEvent.keyDown(download, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(download);
  });

  it("provides a document download without navigating away and localizes Arabic controls", () => {
    render(<TradeEvidenceViewer requestId="trade/1" evidence={{ ...evidence, fileName: "receipt.pdf", mimeType: "application/pdf" }} isAr />);
    fireEvent.click(screen.getByRole("button", { name: "receipt.pdf" }));
    expect(screen.getByRole("dialog").getAttribute("dir")).toBe("rtl");
    expect(screen.queryByRole("img")).toBeNull();
    const download = screen.getByRole("link", { name: "تنزيل الملف" });
    expect(download.getAttribute("href")).toBe(source);
    expect(download.getAttribute("download")).toBe("receipt.pdf");
    expect(download.getAttribute("target")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "إغلاق" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("restores scrolling when the trade or its receipt is removed while viewing", () => {
    const { unmount } = render(<TradeEvidenceViewer requestId="trade/1" evidence={evidence} isAr={false} />);
    fireEvent.click(screen.getByRole("button", { name: evidence.fileName }));
    unmount();
    expect(document.body.style.overflow).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
