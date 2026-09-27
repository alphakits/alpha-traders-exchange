import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LearningShareActions } from "@/components/academy/learning-share-actions";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("friend sharing", () => {
  it.each(["en", "ar"])("shares a fixed localized public destination in %s, without private URL fields", (locale) => {
    window.history.replaceState(null, "", "/en/learn-with-mark?email=private%40example.test&token=secret#interest");
    render(<LearningShareActions locale={locale} />);
    const link = screen.getByRole("link", { name: locale === "ar" ? "شارك على واتساب" : "Share on WhatsApp" });
    const text = new URL(link.getAttribute("href")!).searchParams.get("text")!;
    expect(text).toContain(`https://www.alphatraders.co.il/${locale}/learn-with-mark?`);
    expect(text).toContain("utm_source=friend");
    expect(text).not.toMatch(/private|secret|token=|#interest/);
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("copies the free Academy destination only after the clipboard accepts it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<LearningShareActions locale="en" destination="academy" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Link copied."));
    expect(writeText.mock.calls[0][0]).toContain("/en/learn-trading-free?utm_source=friend");
    expect(writeText.mock.calls[0][0]).not.toContain("learn-with-mark");
  });

  it.each([undefined, { writeText: () => Promise.reject(new Error("denied")) }])("provides a selectable link when clipboard access is unavailable", async clipboard => {
    vi.stubGlobal("navigator", { clipboard });
    render(<LearningShareActions locale="ar" />);
    fireEvent.click(screen.getByRole("button", { name: "انسخ الرابط" }));
    const fallback = await screen.findByRole("textbox", { name: "رابط المشاركة" });
    expect((fallback as HTMLInputElement).readOnly).toBe(true);
    expect((fallback as HTMLInputElement).value).toContain("/ar/learn-with-mark?");
    expect(screen.getByRole("status").textContent).not.toContain("تم نسخ");
  });

  it("does not treat dismissing the native share sheet as an error or a sent message", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("Dismissed", "AbortError"));
    vi.stubGlobal("navigator", { share });
    render(<LearningShareActions locale="en" />);
    fireEvent.click(await screen.findByRole("button", { name: "More share options" }));
    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    await waitFor(() => expect((screen.getByRole("button", { name: "More share options" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("textbox", { name: "Share link" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("retains a usable public link if native sharing is rejected", async () => {
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(new Error("Unsupported")) });
    render(<LearningShareActions locale="en" />);
    fireEvent.click(await screen.findByRole("button", { name: "More share options" }));
    expect(await screen.findByRole("textbox", { name: "Share link" })).toBeTruthy();
  });
});
