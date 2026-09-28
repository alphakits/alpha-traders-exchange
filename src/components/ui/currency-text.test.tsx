import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { brandText, currencyText, moneyText } from "./currency-text";

describe("currency text", () => {
  it("preserves complete labels and Arabic text while coloring full monetary amounts", () => {
    const value = "تم شراء 11,126 USDT · USDT / ILS · 3,874 usdt remaining";
    const { container, rerender } = render(<p>{currencyText(value)}</p>);
    expect(container.textContent).toBe(value);
    expect(container.querySelectorAll(".currency-usdt")).toHaveLength(4);
    expect(container.querySelector(".currency-money")?.textContent).toBe("11,126 USDT");
    rerender(<p>{currencyText("15,000 USDT")}</p>);
    expect(container.textContent).toBe("15,000 USDT");
    expect(container.querySelectorAll(".currency-usdt")).toHaveLength(1);
  });
  it("keeps form labels accessible and does not modify unrelated words or numbers", () => {
    const { container } = render(<><label htmlFor="amount">{currencyText("USDT Amount")}</label><input id="amount" /><p>{currencyText("USDTlike USD 15,000")}</p></>);
    expect(screen.getByLabelText("USDT Amount")).toBeTruthy();
    expect(container.querySelectorAll(".currency-usdt")).toHaveLength(1);
    expect(currencyText(15_000)).toBe(15_000);
    expect(currencyText(null)).toBeNull();
  });
  it("accents English and Arabic brand mentions without changing copy or currency styling", () => {
    const value = "Alpha Traders · ALPHA TRADERS · ألفا تريدرز: 15,000 USDT";
    const { container, rerender } = render(<p>{brandText(value)}</p>);
    expect(container.textContent).toBe(value);
    expect(container.querySelectorAll(".brand-alpha-traders")).toHaveLength(3);
    expect(container.querySelector(".currency-usdt")?.textContent).toBe("15,000 USDT");
    rerender(<p>{brandText("تم استلام إشعار من Alpha Traders")}</p>);
    expect(container.querySelectorAll(".brand-alpha-traders")).toHaveLength(1);
    expect(container.querySelector(".brand-alpha-traders")?.textContent).toBe("Alpha Traders");
  });
  it("preserves mixed children and does not accent partial names or inject markup", () => {
    const { container } = render(<p>{brandText(["Alpha Traders", " & ", <strong key="amount">USDT</strong>, " Alpha Traderslike <script>alert(1)</script>"])}</p>);
    expect(container.querySelectorAll(".brand-alpha-traders")).toHaveLength(1);
    expect(container.querySelector("strong")?.textContent).toBe("USDT");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it.each([
    ["₪1050000.00", "₪1,050,000.00"],
    ["350000 USDT", "350,000 USDT"],
    ["ILS 12000.50", "ILS 12,000.50"],
    ["12000.50 ILS", "12,000.50 ILS"],
    ["usdt 1234.000001", "usdt 1,234.000001"],
    ["1000 – 25000 USDT", "1,000 – 25,000 USDT"],
    ["₪-1000.00", "₪-1,000.00"],
    ["9007199254740993.123456 USDT", "9,007,199,254,740,993.123456 USDT"],
  ])("groups and accents %s without rounding the amount", (value, expected) => {
    const { container } = render(<p>{currencyText(value)}</p>);
    expect(container.textContent).toBe(expected);
    expect(container.querySelector(".currency-money")?.textContent).toBe(expected);
  });

  it("leaves counts, ratings, IDs, percentages, dates and network numbers unchanged", () => {
    const value = "Trust 65.0 · Rating 5.00 · 1000 trades · AT-001000 · 1% · 24/09/2026 · TRC20 · BEP20 · ₪1050000.00 · 2 min";
    const { container, rerender } = render(<p>{currencyText(value)}</p>);
    expect(container.textContent).toBe(value.replace("1050000", "1,050,000"));
    expect([...container.querySelectorAll(".currency-money")].map(node => node.textContent)).toEqual(["₪1,050,000.00"]);
    rerender(<p>{currencyText("تم شراء 15000 USDT مقابل 45000 ILS · 2 صفقات")}</p>);
    expect(container.textContent).toBe("تم شراء 15,000 USDT مقابل 45,000 ILS · 2 صفقات");
    expect([...container.querySelectorAll(".currency-money")].map(node => node.textContent)).toEqual(["15,000 USDT", "45,000 ILS"]);
  });

  it("formats explicitly identified amounts whose currency is in a separate label", () => {
    const { container, rerender } = render(<p>{moneyText("1000.000001")}</p>);
    expect(container.querySelector(".currency-money")?.textContent).toBe("1,000.000001");
    rerender(<p>{moneyText("1050000.00")}</p>);
    expect(container.querySelector(".currency-money")?.textContent).toBe("1,050,000.00");
    expect(currencyText("1000")).toBe("1000");
  });
});
