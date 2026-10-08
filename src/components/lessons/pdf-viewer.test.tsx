import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PdfViewer } from "./pdf-viewer";
import { getLessonBySlug } from "@/lib/content";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));
const asset = getLessonBySlug("candles-foundation")!.assets;
const descriptors = {
  pdf: Object.getOwnPropertyDescriptor(navigator, "pdfViewerEnabled"),
  enabled: Object.getOwnPropertyDescriptor(document, "fullscreenEnabled"),
  element: Object.getOwnPropertyDescriptor(document, "fullscreenElement"),
  request: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "requestFullscreen"),
};
afterEach(() => {
  cleanup();
  for (const [object, key, descriptor] of [
    [navigator, "pdfViewerEnabled", descriptors.pdf],
    [document, "fullscreenEnabled", descriptors.enabled],
    [document, "fullscreenElement", descriptors.element],
    [HTMLElement.prototype, "requestFullscreen", descriptors.request],
  ] as const) {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else Reflect.deleteProperty(object, key);
  }
  vi.restoreAllMocks();
});

describe("workbook capability handling", () => {
  it("offers an actual open action without an endless spinner when inline PDFs are unavailable", () => {
    Object.defineProperty(navigator, "pdfViewerEnabled", { configurable: true, value: false });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const onOpen = vi.fn();
    const { container } = render(<PdfViewer asset={asset} title="Workbook" onOpen={onOpen} />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.queryByText("Loading workbook...")).toBeNull();
    expect(screen.getByText("Open or download the workbook to read it on your device.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read Online" }));
    expect(open).toHaveBeenCalledWith(asset.pdfUrl, "_blank", "noopener,noreferrer");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("tracks external fullscreen exit and recovers if the browser rejects fullscreen", async () => {
    Object.defineProperty(navigator, "pdfViewerEnabled", { configurable: true, value: true });
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    const requestFullscreen = vi.fn(function(this: HTMLElement) {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: this });
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: requestFullscreen });
    render(<PdfViewer asset={asset} title="Workbook" onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Fullscreen$/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Exit Fullscreen" })).toBeTruthy());
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    fireEvent(document, new Event("fullscreenchange"));
    expect(screen.getByRole("button", { name: /^Fullscreen$/ })).toBeTruthy();
    requestFullscreen.mockRejectedValueOnce(new Error("Not allowed"));
    fireEvent.click(screen.getByRole("button", { name: /^Fullscreen$/ }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Use Read Online"));
  });
});
