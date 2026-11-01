import type { AnchorHTMLAttributes } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { propFirms } from "@/lib/prop-firms";
import { FirmGuide } from "./firm-guide";

vi.mock("@/i18n/navigation", () => ({ Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
const firm = propFirms.find(f => f.slug === "topstep")!;
const navigation = propFirms.map(({ slug, name }) => ({ slug, name }));
const field = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } });
const guide = (props: Partial<Parameters<typeof FirmGuide>[0]> = {}) => render(<FirmGuide firm={firm} navigation={navigation} locale="en" {...props} />);

beforeEach(() => window.history.replaceState({}, "", "/en/prop-firms/topstep"));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("visitor account-selection and payout flow", () => {
  it.each(["en", "ar"] as const)("distinguishes direct Zero accounts from evaluation programs (%s)", locale => {
    const fundingpips = propFirms.find(f => f.slug === "fundingpips")!;
    guide({ firm: fundingpips, initialProgram: "zero", locale });
    const rules = document.getElementById("evaluation-rules")!;
    expect(rules.textContent).toContain(locale === "en" ? "Direct account rules" : "شروط الحساب المباشر");
    expect(rules.textContent).not.toContain(locale === "en" ? "Evaluation profit-concentration" : "شروط تركز ربح الامتحان");
    expect(document.body.textContent).not.toContain(locale === "en" ? "After you pass" : "بعد النجاح، شو بصير؟");
    field("firm-program", "two-step");
    expect(rules.textContent).toContain(locale === "en" ? "How to pass" : "شو لازم للنجاح؟");
  });

  it("switches billing and size together without retaining the previous fee", () => {
    guide();
    const cost = screen.getByText("What does it cost?").closest("details")!;
    expect(cost.textContent).toContain("$49");
    expect(cost.textContent).toContain("$149 per XFA");
    field("topstep-billing", "no-activation");
    fireEvent.click(screen.getByRole("button", { name: "150K" }));
    expect(cost.textContent).toContain("$229");
    expect(cost.textContent).toContain("$0 per XFA");
    expect(new URL(window.location.href).searchParams.get("size")).toBe("150000");
  });

  it.each(["en", "ar"] as const)("clears old payout results when the visitor changes account (%s)", locale => {
    guide({ locale });
    field("payout-profit", "5000"); field("payout-days", "5"); field("payout-requested", "2000"); field("payout-fee", "30");
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Calculate" : "احسب النتيجة" }));
    const calculator = document.getElementById("payout-calculator")!;
    expect(calculator.textContent).toContain("$1,770");
    fireEvent.click(screen.getByRole("button", { name: "100K" }));
    expect(document.getElementById("payout-calculator")!.textContent).not.toContain("$1,770");
    expect((document.getElementById("payout-profit") as HTMLInputElement).value).toBe("");
  });

  it("restores a shared choice and copies the current program and size", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    guide({ initialProgram: firm.programs[1].id, initialSize: 150000 });
    expect((document.getElementById("firm-program") as HTMLSelectElement).value).toBe(firm.programs[1].id);
    expect(screen.getByRole("button", { name: "150K" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById("payout-bestDay")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "100K" }));
    fireEvent.click(screen.getByRole("button", { name: "Share this guide" }));
    await screen.findByRole("button", { name: "Link copied" });
    const copied = new URL(writeText.mock.calls[0][0]);
    expect(copied.searchParams.get("program")).toBe(firm.programs[1].id);
    expect(copied.searchParams.get("size")).toBe("100000");
    vi.unstubAllGlobals();
  });

  it("recovers unsupported query choices and sizes absent from a new program", () => {
    const mffu = propFirms.find(f => f.slug === "my-funded-futures")!;
    guide({ firm: mffu, initialProgram: "missing", initialSize: -1 });
    expect((document.getElementById("firm-program") as HTMLSelectElement).value).toBe("rapid");
    expect(screen.getByRole("button", { name: "50K" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "150K" }));
    field("firm-program", "rapid-eod");
    expect(screen.queryByRole("button", { name: "150K" })).toBeNull();
    expect(document.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
  });

  it("estimates dashboard-confirmed rewards using the selected split and flags excessive fees", () => {
    const ftmo = propFirms.find(f => f.slug === "ftmo")!;
    guide({ firm: ftmo });
    field("payout-dashboardAvailable", "1000"); field("payout-share", "90"); field("payout-requested", "1000"); field("payout-fee", "30");
    fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
    const calculator = document.getElementById("payout-calculator")!;
    expect(within(calculator).getByText("$870")).toBeTruthy();
    expect(calculator.textContent).toContain("This is not a payout approval");
    expect(calculator.textContent).not.toContain("The numerical conditions are met");
    field("payout-fee", "901");
    fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
    expect(screen.getByRole("alert").textContent).toContain("Fees cannot exceed your share");
    expect(calculator.textContent).not.toContain("$870");
  });
});
