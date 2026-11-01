import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CardlessVerificationKind } from "@alpha-traders/contracts";
import { CardlessWithdrawalFields } from "./cardless-withdrawal-fields";

afterEach(cleanup);

function Form({ disabled = false, isAr = false }: { disabled?: boolean; isAr?: boolean }) {
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<CardlessVerificationKind>("id_number");
  const [value, setValue] = useState("");
  return <CardlessWithdrawalFields isAr={isAr} disabled={disabled} code={code} verificationKind={kind} verificationValue={value}
    onCodeChange={setCode} onKindChange={setKind} onValueChange={setValue} />;
}

describe("cardless withdrawal form", () => {
  it("requires both inputs and preserves leading zeroes while normalizing Arabic digits", () => {
    render(<Form />);
    const code = screen.getByLabelText("1. Withdrawal code") as HTMLInputElement;
    const id = screen.getByLabelText("2. ID number") as HTMLInputElement;
    expect(code.required).toBe(true);
    expect(id.required).toBe(true);
    fireEvent.change(code, { target: { value: "٠٠١٢٣٤" } });
    fireEvent.change(id, { target: { value: "٠١٢٣٤٥٦٧٨" } });
    expect(code.value).toBe("001234");
    expect(id.value).toBe("012345678");
  });

  it("clears the previous ID when switching to the bank's date-of-birth requirement", () => {
    render(<Form />);
    fireEvent.change(screen.getByLabelText("2. ID number"), { target: { value: "012345678" } });
    fireEvent.change(screen.getByLabelText("Detail requested by the bank"), { target: { value: "date_of_birth" } });
    const birthDate = screen.getByLabelText("2. Date of birth") as HTMLInputElement;
    expect(birthDate.type).toBe("text");
    expect(birthDate.value).toBe("");
    expect(birthDate.required).toBe(true);
    fireEvent.change(birthDate, { target: { value: "٢٥/٠٨/١٩٩٥" } });
    expect(birthDate.value).toBe("25/08/1995");
  });

  it("locks all fields while a submission is pending", () => {
    render(<Form disabled isAr />);
    expect((screen.getByRole("group") as HTMLFieldSetElement).disabled).toBe(true);
    expect(screen.getByLabelText("١. رمز السحب").matches(":disabled")).toBe(true);
    expect(screen.getByLabelText("٢. رقم الهوية").matches(":disabled")).toBe(true);
  });
});
