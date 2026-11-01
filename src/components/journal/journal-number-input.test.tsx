import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { JournalNumberInput } from "./journal-number-input";

it("displays signed grouped money while submitting the original decimal and preserving native limits", () => {
  const { container } = render(<form>
    <label>Net P&amp;L <JournalNumberInput name="net" value="-12345.60" readOnly /></label>
    <label>Entry price <JournalNumberInput type="number" name="price" value="1000.00000001" max={100} step="any" onChange={() => {}} /></label>
  </form>);
  const net = screen.getByRole("textbox", { name: "Net P&L" }) as HTMLInputElement;
  expect(net.nextElementSibling?.textContent).toBe("-12,345.60");
  expect(net.nextElementSibling?.getAttribute("aria-hidden")).toBe("true");
  expect(net.nextElementSibling?.classList.contains("currency-money")).toBe(true);
  expect(new FormData(container.querySelector("form")!).get("net")).toBe("-12345.60");
  const price = screen.getByRole("spinbutton", { name: "Entry price" }) as HTMLInputElement;
  expect(price.nextElementSibling?.textContent).toBe("1,000.00000001");
  expect(price.validity.rangeOverflow).toBe(true);
});
