import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GroupedDecimalInput } from "./grouped-decimal-input";
import { normalizeLocalizedDecimalInput } from "@/lib/trade-amount";

afterEach(cleanup);

function Harness({ initial = "", price = false }: { initial?: string; price?: boolean }) {
  const [value, setValue] = useState(initial);
  return <><GroupedDecimalInput aria-label="Amount" value={value} onValueChange={setValue}
    normalize={price ? (next) => normalizeLocalizedDecimalInput(next, { maximumFractionDigits: 2, maximumWholeDigits: 7 }) : undefined}
  /><output data-testid="raw">{value}</output></>;
}

function edit(value: string, position = value.length, inputType = "insertText") {
  const input = screen.getByRole("textbox") as HTMLInputElement;
  fireEvent.input(input, { target: { value, selectionStart: position, selectionEnd: position }, inputType });
  return input;
}

describe("grouped decimal editing", () => {
  it("groups each keystroke across 999, 1,000 and 10,000 without turning a comma into a decimal", () => {
    render(<Harness initial="999" />);
    expect(edit("9999").value).toBe("9,999");
    expect(edit("9,9999").value).toBe("99,999");
    expect(screen.getByTestId("raw").textContent).toBe("99999");
    expect(edit("1,0000").value).toBe("10,000");
    expect(screen.getByTestId("raw").textContent).toBe("10000");
  });

  it.each(["5000.", "5000.00", "5000.000001", "999999999999.123456"])("preserves exact decimal text %s", (value) => {
    render(<Harness />);
    const input = edit(value);
    expect(input.value).toBe(value.replace(/\B(?=(\d{3})+\.)/g, ","));
    expect(screen.getByTestId("raw").textContent).toBe(value);
    expect(input.selectionStart).toBe(input.value.length);
  });

  it("pastes comma grouped and Arabic amounts, replaces selections and clears fully", () => {
    render(<Harness />);
    expect(edit("50,000.123456", undefined, "insertFromPaste").value).toBe("50,000.123456");
    expect(screen.getByTestId("raw").textContent).toBe("50000.123456");
    expect(edit("٥٬٠٠٠٫١٢٠٠٠٠", undefined, "insertFromPaste").value).toBe("5,000.120000");
    expect(screen.getByTestId("raw").textContent).toBe("5000.120000");
    expect(edit("2500").value).toBe("2,500");
    expect(edit("").value).toBe("");
  });

  it("keeps a middle insertion beside the edited digit after regrouping", () => {
    render(<Harness initial="12345" />);
    const input = edit("129,345", 3);
    expect(input.value).toBe("129,345");
    expect(input.selectionStart).toBe(3);
    expect(screen.getByTestId("raw").textContent).toBe("129345");
  });

  it.each([
    ["deleteContentBackward", "234", "234", 0],
    ["deleteContentForward", "134", "134", 1],
  ] as const)("deletes through a grouping separator using %s", (inputType, displayed, raw, caret) => {
    render(<Harness initial="1234" />);
    const input = edit("1234", 1, inputType);
    expect(input.value).toBe(displayed);
    expect(screen.getByTestId("raw").textContent).toBe(raw);
    expect(input.selectionStart).toBe(caret);
  });

  it("retains price precision and a stable caret when extra decimal places are rejected", () => {
    render(<Harness initial="3.10" price />);
    const input = edit("3.100");
    expect(input.value).toBe("3.10");
    expect(input.selectionStart).toBe(4);
    expect(edit("5000.10").value).toBe("5,000.10");
    expect(screen.getByTestId("raw").textContent).toBe("5000.10");
  });
});
