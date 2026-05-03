import type { Posting, ScenarioPack } from "@/lib/projection";

export function findPaymentPosting(pack: ScenarioPack, accountId: string): Posting | undefined {
  return pack.postings.find((p) =>
    p.enabled &&
    p.destinations?.includes(accountId) &&
    (p.label.toLowerCase().includes("payment") || p.label.toLowerCase().includes("pay"))
  );
}

export function isDebtAccount(label: string): boolean {
  const l = label.toLowerCase();
  return l.includes("loan") || l.includes("debt") || l.includes("mortgage") || l.includes("credit");
}

export function estimateMonthlyPayment(p: Posting | undefined): number {
  if (!p) return 0;
  const num = Number(p.arithmetic);
  if (!Number.isFinite(num)) return 0;
  const freq = p.frequency;
  if (freq === "monthly") return num;
  if (freq === "weekly") return num * 4.33;
  if (freq === "quarterly") return num / 3;
  if (freq === "annual") return num / 12;
  return num;
}
