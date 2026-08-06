import { describe, expect, it } from "vitest";
import { postTradeRoomMessage } from "@/lib/alpha-exchange-store";

describe("trade chat", () => {
  it("is wired for rich trade-room messages", () => {
    expect(typeof postTradeRoomMessage).toBe("function");
  });
});
