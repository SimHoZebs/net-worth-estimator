export function pageURL(value) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Use an HTTP/S page URL without credentials.");
  }
  url.hash = "";
  const keys = [...url.searchParams.keys()];
  for (const key of keys) {
    if (/^(utm_|fbclid$|gclid$|msclkid$)/i.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}

export function appURL(value) {
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash)
    throw new Error("Enter the app origin without a path.");
  const clean = serviceURL(value);
  return new URL(clean).origin;
}

export function serviceURL(value) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Use HTTPS, or HTTP on localhost, without credentials, query, or fragment.");
  }
  return url.href.replace(/\/$/, "");
}

export function newDraft() {
  return {
    id: crypto.randomUUID(),
    name: "",
    cost: "",
    currency: "",
    fromId: "",
    startDate: localDate(),
    sourceUrl: "",
    capturedAt: new Date().toISOString(),
    priceText: "",
    variant: "",
    nameMethod: "manual",
    priceMethod: "manual",
  };
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Price parsing is deliberately conservative. Currency confirmation is separate.
export function parsePrice(value) {
  const text = String(value).trim();
  if (
    text.length > 500 ||
    /(?:[-−]\s*\d|\/\s*(?:mo|month|week|year)|per\s+(?:month|week|year)|\b(?:monthly|weekly|annually|subscription|installment|from|to)\b|\d\s*[-–]\s*\d)/i.test(
      text,
    )
  )
    return "";
  const matches = text.match(/\d[\d.,\s\u00a0]*/g);
  if (!matches || matches.length !== 1) return "";
  let amount = matches[0].trim().replace(/[\s\u00a0]/g, "");
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(amount)) amount = amount.replaceAll(",", "");
  else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(amount))
    amount = amount.replaceAll(".", "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(amount)) amount = amount.replace(",", ".");
  else if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) return "";
  const number = Number(amount);
  return number > 0 && number <= 1e10 ? String(number) : "";
}

export function suggestions(snapshot) {
  const candidates = snapshot.products ?? [];
  const product = candidates.length === 1 ? candidates[0] : null;
  const name = product?.name || snapshot.title || "";
  const priceText = product?.price == null ? "" : String(product.price).slice(0, 500);
  return {
    name: name.slice(0, 100),
    nameMethod: "metadata",
    cost: parsePrice(priceText),
    priceText,
    priceMethod: "metadata",
    currency: product?.currency === "USD" ? "USD" : "",
    variant: String(product?.variant ?? "").slice(0, 300),
  };
}

export function purchaseRequest(draft, accounts, purchases = []) {
  const cost = Number(draft.cost);
  if (!draft.name.trim() || draft.name.trim().length > 100)
    throw new Error("Enter a purchase name of at most 100 characters.");
  if (
    !Number.isFinite(cost) ||
    cost < 0.01 ||
    cost > 1e10 ||
    Math.abs(cost * 100 - Math.round(cost * 100)) > 0.0001
  )
    throw new Error("Enter a positive cost in dollars and cents.");
  if (draft.currency !== "USD") throw new Error("Confirm that the purchase cost is in USD.");
  if (!accounts.some((account) => account.id === draft.fromId))
    throw new Error("Choose a current funding account.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate) ||
    new Date(`${draft.startDate}T00:00:00Z`).toISOString().slice(0, 10) !== draft.startDate
  )
    throw new Error("Choose a valid earliest purchase date.");
  if (purchases.length >= 100)
    throw new Error("The purchase queue is full. Remove an item in Waypoint first.");
  const priority = purchases.reduce((max, purchase) => Math.max(max, purchase.priority), -1) + 1;
  return {
    id: draft.id,
    name: draft.name.trim(),
    fundingAccountId: draft.fromId,
    cost,
    earliestDate: draft.startDate,
    priority,
    enabled: true,
  };
}
