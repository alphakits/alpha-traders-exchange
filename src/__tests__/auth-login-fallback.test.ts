import { describe, expect, it } from "vitest";
import { authenticateLocalUser } from "@/lib/auth";

describe("authenticateLocalUser", () => {
  it("authenticates the preserved test accounts through the local password flow", async () => {
    const owner = await authenticateLocalUser("jozenmark834@yahoo.com", "Roflxd123!");
    const buyer = await authenticateLocalUser("markwick99@yahoo.com", "Roflxd123!");
    const seller = await authenticateLocalUser("marksally11@yahoo.com", "Roflxd123!");

    expect(owner?.email).toBe("jozenmark834@yahoo.com");
    expect(buyer?.email).toBe("markwick99@yahoo.com");
    expect(seller?.email).toBe("marksally11@yahoo.com");
  });
});
