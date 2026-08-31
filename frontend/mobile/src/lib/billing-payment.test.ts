import { describe, expect, it } from "vitest";
import { alipayPaymentUrl, isTerminalBillingStatus, safeBillingPaymentUrl } from "./billing-payment";

describe("mobile billing payment helpers", () => {
  it("wraps an HTTPS payment session for the Alipay internal browser", () => {
    const paymentUrl = "https://pay.example.test/session?id=abc&from=aetherx";
    expect(alipayPaymentUrl(paymentUrl)).toBe(
      `alipays://platformapi/startapp?appId=20000067&url=${encodeURIComponent(paymentUrl)}`
    );
  });

  it("rejects unsafe payment URLs", () => {
    expect(() => safeBillingPaymentUrl("http://pay.example.test/session")).toThrow("不安全");
    expect(() => safeBillingPaymentUrl("javascript:alert(1)")).toThrow("不安全");
  });

  it("continues polling only while a payment remains pending", () => {
    expect(isTerminalBillingStatus("pending")).toBe(false);
    expect(isTerminalBillingStatus("paid")).toBe(true);
    expect(isTerminalBillingStatus("refunded")).toBe(true);
  });
});
