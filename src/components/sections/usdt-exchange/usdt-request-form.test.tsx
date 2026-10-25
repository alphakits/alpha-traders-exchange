import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateCardlessUsdtAmount } from "@alpha-traders/contracts";
import { formatUsdt } from "@/lib/usdt-demand-format";
import type { DemandTerms } from "@/types/usdt-demand";
import { RequestForm, type RequestFormProps } from "./usdt-request-form";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const now = Date.parse("2026-10-24T00:00:00Z");
const initial: DemandTerms = { amount: "5000", price: "3.30", paymentMethod: "Bank Transfer", network: "TRC20", city: "" };
const reference = { price: "3.30", minimum: "2.95", maximum: "3.65" };

function Harness(props: Partial<RequestFormProps> & { initialTerms?: DemandTerms } = {}) {
  const [terms, setTerms] = useState(props.initialTerms ?? initial);
  const [cash, setCash] = useState("1000");
  return <><RequestForm ar={false} terms={terms} setTerms={setTerms} cash={cash} setCash={setCash}
    reference={reference} busy={false} mode="create" stale={false} now={now} onSubmit={() => {}}
    onClose={() => {}} onReload={() => {}} {...props} /><output data-testid="terms">{JSON.stringify(terms)}</output></>;
}
function form() { return screen.getByRole("form", { name: "Request details" }) as HTMLFormElement; }
function submitButton(name = "Publish request") { return screen.getByRole("button", { name }) as HTMLButtonElement; }
function amountInput() { return screen.getByLabelText("Amount (USDT)") as HTMLInputElement; }
function pasteAmount(text: string) {
  amountInput().setSelectionRange(0, amountInput().value.length);
  fireEvent.paste(amountInput(), { clipboardData: { getData: () => text } });
}

describe("buyer USDT request form", () => {
  it("rounds the main USDT display while retaining the exact trade quantity and payment", () => {
    render(<Harness initialTerms={{ ...initial, amount: "660.6607" }} />);
    const estimate = screen.getByRole("region", { name: "Estimated payment" });
    expect(within(estimate).getByText("≈661 USDT")).toBeTruthy();
    expect(within(estimate).getByText("₪2,201.98")).toBeTruthy();
    expect(within(estimate).getByText("View exact USDT amount").closest("details")?.open).toBe(false);
    expect(within(estimate).getByText("660.6607 USDT")).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("terms").textContent!).amount).toBe("660.6607");
  });
  it.each([["2.74", true], ["2.75", false], ["3.45", false], ["3.46", true]])("enforces the live 3.10 band for requested price %s", (price, disabled) => {
    const onSubmit = vi.fn();
    render(<Harness initialTerms={{ ...initial, price: String(price) }} reference={{ price: "3.10", minimum: "2.75", maximum: "3.45" }} onSubmit={onSubmit} />);
    expect(submitButton().disabled).toBe(disabled);
    fireEvent.submit(form());
    expect(onSubmit).toHaveBeenCalledTimes(disabled ? 0 : 1);
  });
  it("uses authoritative cent bounds even when the provider reference has more than six decimals", () => {
    render(<Harness initialTerms={{ ...initial, price: "3.45" }} reference={{ price: "3.100000001", minimum: "2.76", maximum: "3.45" }} />);
    expect(submitButton().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Requested price per USDT (ILS)"), { target: { value: "2.75" } });
    expect(submitButton().disabled).toBe(true);
  });
  it("updates bounds immediately after a quote change without silently rewriting the buyer price", () => {
    const view = render(<Harness initialTerms={{ ...initial, price: "3.60" }} />);
    expect(submitButton().disabled).toBe(false);
    view.rerender(<Harness reference={{ price: "3.10", minimum: "2.75", maximum: "3.45" }} />);
    expect(submitButton().disabled).toBe(true);
    expect((screen.getByLabelText("Requested price per USDT (ILS)") as HTMLInputElement).value).toBe("3.60");
    expect(document.getElementById("request-submit-help")?.textContent).toContain("between ₪2.75 and ₪3.45");
  });
  it("shows grouped amounts, exact payment detail, limits and clear field labels", () => {
    render(<Harness publishing={{ nextAllowedAt: null, remaining: 1 }} />);
    expect(form().id).toBe("request-form");
    expect(amountInput().value).toBe("5,000");
    expect(amountInput().getAttribute("pattern")).toBeNull();
    expect(amountInput().getAttribute("maxlength")).toBeNull();
    const estimate = screen.getByRole("region", { name: "Estimated payment" });
    expect(within(estimate).getByText("₪16,665.00")).toBeTruthy();
    expect(within(estimate).getByText("₪165.00")).toBeTruthy();
    expect(screen.getByText(/1 of 2 request slots remaining/)).toBeTruthy();
    expect(submitButton().disabled).toBe(false);
  });

  it("checks native validity before forwarding a valid submit", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const validity = vi.spyOn(form(), "reportValidity");
    fireEvent.submit(form());
    expect(validity).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it.each(["1,23", "5000.1234567", "5000 USDT"])("blocks malformed or overprecise pasted amount %s without submitting the previous amount", value => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    pasteAmount(value);
    expect(amountInput().value).toBe(value);
    fireEvent.submit(form());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBeTruthy();
  });

  it("clears a reported error when valid pasted corrections retain the same canonical amount or price", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    pasteAmount("1,23");
    fireEvent.submit(form());
    expect(screen.getByRole("alert")).toBeTruthy();
    pasteAmount("5,000");
    expect(amountInput().value).toBe("5,000");
    expect(amountInput().checkValidity()).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();

    const price = screen.getByLabelText("Requested price per USDT (ILS)") as HTMLInputElement;
    price.setSelectionRange(0, price.value.length);
    fireEvent.paste(price, { clipboardData: { getData: () => "3.301" } });
    fireEvent.submit(form());
    expect(screen.getByRole("alert")).toBeTruthy();
    price.setSelectionRange(0, price.value.length);
    fireEvent.paste(price, { clipboardData: { getData: () => "3.30" } });
    expect(price.value).toBe("3.30");
    expect(price.checkValidity()).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.submit(form());
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("uses amount presets to replace an invalid draft even when the canonical amount is unchanged", () => {
    render(<Harness />);
    pasteAmount("1,23");
    fireEvent.submit(form());
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "5,000 USDT" }));
    expect(amountInput().value).toBe("5,000");
    expect(amountInput().checkValidity()).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "500 USDT" }));
    expect(amountInput().value).toBe("500");
    expect(JSON.parse(screen.getByTestId("terms").textContent!).amount).toBe("500");
  });

  it("only updates the requested price when the reference button is chosen", () => {
    const view = render(<Harness initialTerms={{ ...initial, price: "3.20" }} />);
    const price = screen.getByLabelText("Requested price per USDT (ILS)") as HTMLInputElement;
    view.rerender(<Harness initialTerms={{ ...initial, price: "3.20" }} reference={{ ...reference, price: "3.31" }} />);
    expect(price.value).toBe("3.20");
    fireEvent.click(screen.getByRole("button", { name: "Use reference price" }));
    expect((screen.getByLabelText("Requested price per USDT (ILS)") as HTMLInputElement).value).toBe("3.31");
  });

  it("clears an invalid price draft when the same canonical reference price is chosen", () => {
    render(<Harness />);
    const price = screen.getByLabelText("Requested price per USDT (ILS)") as HTMLInputElement;
    price.setSelectionRange(0, price.value.length);
    fireEvent.paste(price, { clipboardData: { getData: () => "3.301" } });
    expect(price.value).toBe("3.301");
    fireEvent.submit(form());
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use reference price" }));
    const corrected = screen.getByLabelText("Requested price per USDT (ILS)") as HTMLInputElement;
    expect(corrected.value).toBe("3.30");
    expect(corrected.checkValidity()).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    [{ amount: "0" }, "positive USDT"],
    [{ amount: "1000000000" }, "9 whole digits"],
    [{ amount: "1.1234567" }, "6 decimal places"],
    [{ price: "0" }, "positive price"],
    [{ price: "3.301" }, "2 decimal places"],
    [{ price: "10000" }, "positive price"],
    [{ price: "2.94" }, "between ₪2.95 and ₪3.65"],
    [{ price: "3.66" }, "between ₪2.95 and ₪3.65"],
    [{ amount: "0.000001" }, "at least ₪0.01"],
    [{ paymentMethod: "Face-to-Face (Meet in Person)", city: "City123" }, "meeting city"],
    [{ paymentMethod: "Face-to-Face (Meet in Person)", city: ".." }, "meeting city"],
  ] as Array<[Partial<DemandTerms>, string]>)("explains invalid request terms %j", (changes, explanation) => {
    const onSubmit = vi.fn();
    render(<Harness initialTerms={{ ...initial, ...changes }} onSubmit={onSubmit} />);
    expect(submitButton().disabled).toBe(true);
    expect(document.getElementById("request-submit-help")?.textContent).toContain(explanation);
    fireEvent.submit(form());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(["2.95", "3.65"])("allows the current quote boundary %s", price => {
    render(<Harness initialTerms={{ ...initial, price }} />);
    expect(submitButton().disabled).toBe(false);
  });

  it("supports a Unicode meeting city and clears it when the payment method changes", () => {
    render(<Harness initialTerms={{ ...initial, paymentMethod: "Face-to-Face (Meet in Person)", city: "القدس" }} />);
    expect(submitButton().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "Bank Transfer" } });
    expect(screen.queryByLabelText("Meeting city")).toBeNull();
    expect(JSON.parse(screen.getByTestId("terms").textContent!).city).toBe("");
  });

  it("calculates ATM USDT from the cash total including the fee", () => {
    const onSubmit = vi.fn();
    render(<Harness initialTerms={{ ...initial, paymentMethod: "Cardless ATM Withdrawal", amount: "7" }} onSubmit={onSubmit} />);
    expect(screen.queryByLabelText("Amount (USDT)")).toBeNull();
    const estimate = screen.getByRole("region", { name: "Estimated payment" });
    expect(within(estimate).getByText(`${formatUsdt(calculateCardlessUsdtAmount("1000", "3.30", true))} USDT`)).toBeTruthy();
    expect(within(estimate).getByText("₪1,000.00")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("ATM cash total incl. 1% fee (ILS)"), { target: { value: "5000" } });
    expect(within(estimate).getByText("₪5,000.00")).toBeTruthy();
    expect(submitButton().disabled).toBe(false);
    fireEvent.submit(form());
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("requires a fresh quote and provides a reason beside the disabled submit", () => {
    render(<Harness reference={null} />);
    expect(submitButton().disabled).toBe(true);
    expect(document.getElementById("request-submit-help")?.textContent).toContain("fresh price reference");
    expect((screen.getByRole("button", { name: "Use reference price" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses the supplied clock for a publishing cooldown and enables when it ends", () => {
    const publishing = { nextAllowedAt: new Date(now + 125_000).toISOString(), remaining: 1 };
    const view = render(<Harness publishing={publishing} />);
    expect(submitButton().disabled).toBe(true);
    expect(document.getElementById("request-submit-help")?.textContent).toContain("2:05");
    view.rerender(<Harness publishing={publishing} now={now + 126_000} />);
    expect(submitButton().disabled).toBe(false);
  });

  it("allows editing the open request even when both slots are used and the next publication is blocked", () => {
    const publishing = { nextAllowedAt: new Date(now + 86400000).toISOString(), remaining: 0, openRequestId: "own-request" };
    const view = render(<Harness publishing={publishing} />);
    expect(submitButton().disabled).toBe(true);
    expect(document.getElementById("request-submit-help")?.textContent).toContain("already have an open request");
    view.rerender(<Harness publishing={publishing} mode="edit" expiresAt={new Date(now + 3600000).toISOString()} />);
    expect(submitButton("Save changes").disabled).toBe(false);
    expect(screen.getByText(/Editing is free and keeps your original expiry time/)).toBeTruthy();
    expect(screen.getByText(/0 of 2 request slots remaining/)).toBeTruthy();
  });

  it("blocks republishing at the daily limit while explaining that current requests can still be edited", () => {
    render(<Harness publishing={{ nextAllowedAt: null, remaining: 0 }} mode="renew" />);
    expect(submitButton("Publish again").disabled).toBe(true);
    expect(document.getElementById("request-submit-help")?.textContent).toContain("used both request slots");
    expect(screen.getByText(/12 hours per request/)).toBeTruthy();
  });

  it("does not silently turn an expired edit into a new publication", () => {
    const onSubmit = vi.fn();
    const view = render(<Harness mode="edit" expiresAt={new Date(now + 1000).toISOString()} onSubmit={onSubmit} />);
    expect(submitButton("Save changes").disabled).toBe(false);
    view.rerender(<Harness mode="edit" expiresAt={new Date(now + 1000).toISOString()} now={now + 1000} onSubmit={onSubmit} />);
    expect(submitButton("Save changes").disabled).toBe(true);
    fireEvent.submit(form());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.getElementById("request-submit-help")?.textContent).toContain("expired while you were editing");
  });

  it("blocks stale editing and offers an explicit reload action", () => {
    const onReload = vi.fn(); const onSubmit = vi.fn(); const onClose = vi.fn();
    render(<Harness stale mode="edit" expiresAt={new Date(now + 3600000).toISOString()} onReload={onReload} onSubmit={onSubmit} onClose={onClose} />);
    expect(submitButton("Save changes").disabled).toBe(true);
    expect(amountInput().closest("fieldset")?.disabled).toBe(true);
    fireEvent.submit(form());
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload latest details" }));
    expect(onReload).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders Arabic labels with left-to-right monetary values", () => {
    render(<Harness ar />);
    expect(screen.getByRole("form", { name: "تفاصيل الطلب" }).getAttribute("dir")).toBe("rtl");
    expect((screen.getByLabelText("المبلغ (USDT)") as HTMLInputElement).value).toBe("5,000");
    expect(screen.getByLabelText("المبلغ (USDT)").getAttribute("dir")).toBe("ltr");
    expect(screen.getByRole("button", { name: "نشر الطلب" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "الدفع المتوقع" })).toBeTruthy();
  });
});
