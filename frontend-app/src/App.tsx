import React from "react";
import { calculateCartTotal } from "./utils/pricing";

export function App() {
  const sampleTotal = calculateCartTotal(
    [
      { price: 49.5, qty: 2 },
      { price: 15, qty: 1 },
    ],
    { discountPercent: 10 }
  );

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>React + Copilot + Jenkins Blueprint</h1>
      <p>Sample discounted order total: ${sampleTotal.toFixed(2)}</p>
    </main>
  );
}
