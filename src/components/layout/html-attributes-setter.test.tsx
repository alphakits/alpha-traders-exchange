import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HtmlAttributesSetter } from "@/components/layout/html-attributes-setter";

describe("HtmlAttributesSetter", () => {
  it("keeps document language and direction synchronized after client locale changes", async () => {
    const { rerender } = render(<HtmlAttributesSetter lang="en" dir="ltr" />);

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("en");
      expect(document.documentElement.dir).toBe("ltr");
    });

    rerender(<HtmlAttributesSetter lang="ar" dir="rtl" />);

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("ar");
      expect(document.documentElement.dir).toBe("rtl");
    });
  });
});
