export interface CartItem {
  price: number;
  qty: number;
}

export interface PricingOptions {
  discountPercent?: number;
  couponCode?: string;
}

export function calculateCartTotal(items: CartItem[], options: PricingOptions = {}): number {
  const { discountPercent = 0, couponCode } = options;
  if (discountPercent < 0 || discountPercent > 100) {
    throw new RangeError("discountPercent must be between 0 and 100");
  }

  const subtotal = items.reduce((sum, item) => {
    if (item.price < 0 || item.qty < 0) {
      throw new RangeError("price and qty must be non-negative");
    }
    return sum + item.price * item.qty;
  }, 0);

  let total = subtotal * (1 - discountPercent / 100);

  if (couponCode) {
    if (couponCode === "SAVE10") {
      total = total * 0.9;
    } else if (couponCode === "FLAT5") {
      total = Math.max(0, total - 5);
    } else {
      throw new RangeError(`Unknown couponCode: ${couponCode}`);
    }
  }

  return Math.round(total * 100) / 100;
}
