import { describe, it, expect, vi } from "vitest";
import { updateOwner } from "./update-owner.js";

describe("updateOwner", () => {
  function makeMockConnection() {
    const updateFn = vi.fn().mockResolvedValue({ id: "001", success: true });
    const sobjectFn = vi.fn().mockReturnValue({ update: updateFn });
    return { conn: { sobject: sobjectFn } as any, sobjectFn, updateFn };
  }

  it("calls sobject().update() with correct OwnerId for Lead", async () => {
    const { conn, sobjectFn, updateFn } = makeMockConnection();

    await updateOwner(conn, "Lead", "00Q000000000001", "005000000000001");

    expect(sobjectFn).toHaveBeenCalledWith("Lead");
    expect(updateFn).toHaveBeenCalledWith({
      Id: "00Q000000000001",
      OwnerId: "005000000000001",
    });
  });

  it("calls sobject().update() with correct OwnerId for Contact", async () => {
    const { conn, sobjectFn, updateFn } = makeMockConnection();

    await updateOwner(conn, "Contact", "003000000000001", "005000000000002");

    expect(sobjectFn).toHaveBeenCalledWith("Contact");
    expect(updateFn).toHaveBeenCalledWith({
      Id: "003000000000001",
      OwnerId: "005000000000002",
    });
  });

  it("calls sobject().update() with correct OwnerId for Account", async () => {
    const { conn, sobjectFn, updateFn } = makeMockConnection();

    await updateOwner(conn, "Account", "001000000000001", "00G000000000001");

    expect(sobjectFn).toHaveBeenCalledWith("Account");
    expect(updateFn).toHaveBeenCalledWith({
      Id: "001000000000001",
      OwnerId: "00G000000000001",
    });
  });
});
