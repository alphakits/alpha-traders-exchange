import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupedDecimalInput } from "./usdt-number-input";

afterEach(cleanup);

function Harness({ initial = "", fraction = 6, integer = 12 }: { initial?: string; fraction?: number; integer?: number }) {
  const [value, setValue] = useState(initial);
  return <><GroupedDecimalInput aria-label="Amount" value={value} onValueChange={setValue}
    maxFractionDigits={fraction} maxIntegerDigits={integer} /><output data-testid="raw">{value}</output></>;
}

function input() { return screen.getByRole("textbox") as HTMLInputElement; }
function raw() { return screen.getByTestId("raw").textContent; }
function edit(value: string, position = value.length, inputType = "insertText") {
  const element = input();
  fireEvent.input(element, { target: { value, selectionStart: position, selectionEnd: position }, inputType });
  return element;
}
function paste(value: string, start = 0, end = input().value.length) {
  const element = input();
  element.setSelectionRange(start, end);
  fireEvent.paste(element, { clipboardData: { getData: () => value } });
  return element;
}

describe("request decimal input", () => {
  it("groups typed digits and retains the canonical request value", () => {
    render(<Harness />);
    expect(edit("5000").value).toBe("5,000");
    expect(raw()).toBe("5000");
    expect(edit("5,0000").value).toBe("50,000");
    expect(raw()).toBe("50000");
    expect(input().selectionStart).toBe(6);
  });

  it.each([
    ["5000.", "5,000."], ["16665.00", "16,665.00"],
    ["5000.123456", "5,000.123456"], ["0.000001", "0.000001"],
  ])("keeps decimal entry %s intact", (value, expected) => {
    render(<Harness />);
    expect(edit(value).value).toBe(expected);
    expect(raw()).toBe(value);
    expect(input().selectionStart).toBe(expected.length);
  });

  it("adds a leading zero while retaining a newly entered decimal point", () => {
    render(<Harness />);
    expect(edit(".").value).toBe("0.");
    expect(input().selectionStart).toBe(2);
    expect(edit("0.1").value).toBe("0.1");
    expect(raw()).toBe("0.1");
  });

  it("keeps the cursor beside a middle insertion after regrouping", () => {
    render(<Harness initial="12345" />);
    expect(edit("129,345", 3).value).toBe("129,345");
    expect(raw()).toBe("129345");
    expect(input().selectionStart).toBe(3);
  });

  it.each([
    ["deleteContentBackward", "234", 0], ["deleteContentForward", "134", 1],
  ])("deletes a digit through a generated comma with %s", (inputType, expected, caret) => {
    render(<Harness initial="1234" />);
    expect(edit("1234", 1, inputType).value).toBe(expected);
    expect(raw()).toBe(expected);
    expect(input().selectionStart).toBe(caret);
  });

  it("does not delete an extra digit when the comma alone is explicitly selected", () => {
    render(<Harness initial="1234" />);
    input().setSelectionRange(1, 2);
    fireEvent.select(input());
    expect(edit("1234", 1, "deleteContentBackward").value).toBe("1,234");
    expect(raw()).toBe("1234");
  });

  it.each([
    ["5,000", "5,000", "5000"],
    ["٥٬٠٠٠٫١٢٠٠٠٠", "5,000.120000", "5000.120000"],
    ["۱۶٬۶۶۵٫۰۰", "16,665.00", "16665.00"],
  ])("accepts an unambiguous pasted amount %s", (value, displayed, canonical) => {
    render(<Harness />);
    expect(paste(value).value).toBe(displayed);
    expect(raw()).toBe(canonical);
    expect(input().checkValidity()).toBe(true);
    expect(input().selectionStart).toBe(displayed.length);
  });

  it("pastes into a selection without mistaking generated grouping for clipboard punctuation", () => {
    render(<Harness initial="12345" />);
    expect(paste("9", 1, 2).value).toBe("19,345");
    expect(raw()).toBe("19345");
    expect(input().selectionStart).toBe(2);
    expect(paste(".25", input().value.length, input().value.length).value).toBe("19,345.25");
    expect(raw()).toBe("19345.25");
  });

  it.each(["1,23", "12,34,567", "1.234,56", "1,,000", "5 000", "5000 USDT", "1e3", "-5000", "1.2.3", "١٢٬٣٤"])("keeps invalid pasted punctuation or text %s visible and blocks submission", value => {
    render(<Harness initial="5000" />);
    expect(paste(value).value).toBe(value);
    expect(raw()).toBe("5000");
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(input().checkValidity()).toBe(false);
    expect(input().validationMessage).toContain("correctly grouped");
  });

  it("does not silently truncate excess fraction digits and lets the user correct them", () => {
    render(<Harness initial="3.10" fraction={2} />);
    expect(edit("3.100").value).toBe("3.100");
    expect(raw()).toBe("3.10");
    expect(input().validationMessage).toContain("2 decimal places");
    expect(edit("3.10", 4, "deleteContentBackward").value).toBe("3.10");
    expect(raw()).toBe("3.10");
    expect(input().checkValidity()).toBe(true);
    expect(input().getAttribute("aria-invalid")).toBe(null);
  });

  it("rejects excess integer digits and a fractional value in a whole-number field", () => {
    render(<Harness initial="5000" integer={4} fraction={0} />);
    expect(paste("50000").value).toBe("50000");
    expect(raw()).toBe("5000");
    expect(input().validationMessage).toContain("4 digits");
    expect(paste("5000.1").value).toBe("5000.1");
    expect(raw()).toBe("5000");
    expect(input().validationMessage).toBe("Use a whole number.");
  });

  it("clears invalid content fully and accepts a corrected amount", () => {
    render(<Harness initial="5000" />);
    paste("1,23");
    expect(edit("").value).toBe("");
    expect(raw()).toBe("");
    expect(input().checkValidity()).toBe(true);
    expect(paste("16,665.00").value).toBe("16,665.00");
    expect(raw()).toBe("16665.00");
  });

  it("drops an invalid draft when the owner replaces the amount", () => {
    const props = { "aria-label": "Amount", onValueChange: vi.fn(), maxFractionDigits: 6 };
    const view = render(<GroupedDecimalInput {...props} value="5000" />);
    paste("1,23");
    view.rerender(<GroupedDecimalInput {...props} value="6000" />);
    expect(input().value).toBe("6,000");
    expect(input().checkValidity()).toBe(true);
  });

  it("prevents edits to read-only and disabled fields", () => {
    const onValueChange = vi.fn();
    const view = render(<GroupedDecimalInput aria-label="Amount" value="5000" onValueChange={onValueChange} maxFractionDigits={6} readOnly />);
    paste("1000");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(input().value).toBe("5,000");
    view.rerender(<GroupedDecimalInput aria-label="Amount" value="5000" onValueChange={onValueChange} maxFractionDigits={6} disabled />);
    expect(input().disabled).toBe(true);
    paste("1000");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("waits for hydration so a user's first amount cannot be erased before handlers attach", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(<Harness />);
    const element = container.querySelector("input")!;
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      expect(element.disabled).toBe(true);
      await act(async () => { root = hydrateRoot(container, <Harness />); });
      expect(element.disabled).toBe(false);
      fireEvent.input(element, { target: { value: "5000", selectionStart: 4, selectionEnd: 4 }, inputType: "insertText" });
      expect(element.value).toBe("5,000");
      expect(container.querySelector("output")?.textContent).toBe("5000");
    } finally {
      if (root) await act(async () => { root!.unmount(); });
      container.remove();
    }
  });
});
