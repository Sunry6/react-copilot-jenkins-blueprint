import { describe, it, expect } from "vitest";
import { calculateCartTotal } from "./pricing";

describe("calculateCartTotal", () => {
  it("computes subtotal without discount", () => {
    expect(calculateCartTotal([{ price: 25, qty: 2 }])).toBe(50);
  });

  it("applies percentage discount and SAVE10 coupon", () => {
    expect(
      calculateCartTotal([{ price: 100, qty: 1 }], {
        discountPercent: 20,
        couponCode: "SAVE10",
      })
    ).toBe(72);
  });

  it("applies VIP20 coupon as an extra 20% off", () => {
    expect(calculateCartTotal([{ price: 100, qty: 1 }], { couponCode: "VIP20" })).toBe(80);
    expect(
      calculateCartTotal([{ price: 100, qty: 1 }], {
        discountPercent: 10,
        couponCode: "VIP20",
      })
    ).toBe(72);
  });

  it("floors FLAT5 coupon at zero", () => {
    expect(calculateCartTotal([{ price: 3, qty: 1 }], { couponCode: "FLAT5" })).toBe(0);
  });

  it("rejects unknown coupon codes", () => {
    expect(() => calculateCartTotal([{ price: 10, qty: 1 }], { couponCode: "BAD" })).toThrow(
      RangeError
    );
  });
});
