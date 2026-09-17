import { describe, expect, it } from "vitest";
import {
  isLoginBlockedStatus,
  issuedSessionIsValid,
  tokenAuthEpoch,
} from "./member-auth-access";

describe("member auth epoch / closed access", () => {
  it("treats a missing token epoch as 0", () => {
    expect(tokenAuthEpoch(undefined)).toBe(0);
    expect(tokenAuthEpoch(null)).toBe(0);
    expect(tokenAuthEpoch("1")).toBe(0);
    expect(tokenAuthEpoch(0)).toBe(0);
    expect(tokenAuthEpoch(1)).toBe(1);
  });

  it("CASE 9: old JWT at epoch N is rejected after close increments to N+1", () => {
    expect(
      issuedSessionIsValid({
        memberExists: true,
        status: "closed",
        dbEpoch: 1,
        tokenEpoch: 0,
      })
    ).toBe(false);
    expect(
      issuedSessionIsValid({
        memberExists: true,
        status: "closed",
        dbEpoch: 1,
        tokenEpoch: 1,
      })
    ).toBe(false);
  });

  it("CASE 10: old Bearer/mobile token epoch 0 fails after close", () => {
    expect(
      issuedSessionIsValid({
        memberExists: true,
        status: "closed",
        dbEpoch: 1,
        tokenEpoch: undefined,
      })
    ).toBe(false);
  });

  it("CASE 11: closed and suspended cannot login; missing member cannot use a session", () => {
    expect(isLoginBlockedStatus("closed")).toBe(true);
    expect(isLoginBlockedStatus("suspended")).toBe(true);
    expect(isLoginBlockedStatus("active")).toBe(false);
    expect(
      issuedSessionIsValid({
        memberExists: false,
        status: "active",
        dbEpoch: 0,
        tokenEpoch: 0,
      })
    ).toBe(false);
  });

  it("active member with matching epoch remains valid; suspended JWT is not revoked by epoch", () => {
    expect(
      issuedSessionIsValid({
        memberExists: true,
        status: "active",
        dbEpoch: 0,
        tokenEpoch: undefined,
      })
    ).toBe(true);
    expect(
      issuedSessionIsValid({
        memberExists: true,
        status: "suspended",
        dbEpoch: 0,
        tokenEpoch: 0,
      })
    ).toBe(true);
  });
});
