import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("defaults to a non-submit button type", () => {
    render(React.createElement(Button, null, "Launch"));
    const button = screen.getByRole("button", { name: "Launch" });
    expect(button.getAttribute("type")).toBe("button");
  });
});
