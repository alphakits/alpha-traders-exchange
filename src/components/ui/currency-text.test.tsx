import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { currencyText } from "./currency-text";

describe("currency text", () => {
  it("preserves complete labels, amounts and Arabic text while coloring only the currency", () => {
    const value = "تم شراء 11,126 USDT · USDT / ILS · 3,874 usdt remaining";
    const { container, rerender } = render(<p>{currencyText(value)}</p>);
    expect(container.textContent).toBe(value);
    expect(container.querySelectorAll(".currency-usdt")).toHaveLength(3);
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
});
