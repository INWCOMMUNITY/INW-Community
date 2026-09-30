import { describe, expect, it, vi } from "vitest";
import { retrieveCheckoutChargeId } from "./source-charge";

describe("retrieveCheckoutChargeId", () => {
  it("returns a Charge id string from latest_charge", async () => {
    const stripe = {
      paymentIntents: {
        retrieve: vi.fn(async () => ({ latest_charge: "ch_abc" })),
      },
    };
    await expect(retrieveCheckoutChargeId(stripe as never, "pi_1")).resolves.toBe("ch_abc");
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_1", { expand: ["latest_charge"] });
  });

  it("returns Charge.id from an expanded latest_charge object", async () => {
    const stripe = {
      paymentIntents: {
        retrieve: vi.fn(async () => ({ latest_charge: { id: "ch_obj" } })),
      },
    };
    await expect(retrieveCheckoutChargeId(stripe as never, "pi_1")).resolves.toBe("ch_obj");
  });

  it("returns null when paymentIntentId is missing", async () => {
    const stripe = { paymentIntents: { retrieve: vi.fn() } };
    await expect(retrieveCheckoutChargeId(stripe as never, null)).resolves.toBeNull();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("returns null when retrieve fails", async () => {
    const stripe = {
      paymentIntents: {
        retrieve: vi.fn(async () => {
          throw new Error("stripe down");
        }),
      },
    };
    await expect(retrieveCheckoutChargeId(stripe as never, "pi_1")).resolves.toBeNull();
  });
});
