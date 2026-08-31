export type BillingPaymentStatus = "pending" | "paid" | "failed" | "closed" | "refunded";

export function safeBillingPaymentUrl(value: string) {
  let url: URL;
  try { url = new URL(String(value || "")); }
  catch { throw new Error("充值链接不安全或已经失效。"); }
  if (url.protocol !== "https:" || url.username || url.password || url.href.length > 2_000) {
    throw new Error("充值链接不安全或已经失效。");
  }
  return url.href;
}

export function alipayPaymentUrl(value: string) {
  const paymentUrl = safeBillingPaymentUrl(value);
  return `alipays://platformapi/startapp?appId=20000067&url=${encodeURIComponent(paymentUrl)}`;
}

export function isTerminalBillingStatus(status: BillingPaymentStatus) {
  return status !== "pending";
}
