// Self-contained: Chrome serializes this function into an isolated content world.
// Return only bounded product facts and visible text, never raw HTML or inputs.
export function capturePage() {
  const products = [];
  const add = (value) => {
    if (!value || products.length >= 10) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 20)) add(item);
      return;
    }
    if (value["@graph"]) add(value["@graph"]);
    const types = [].concat(value["@type"] ?? []);
    if (!types.includes("Product")) return;
    const offers = [].concat(value.offers ?? []);
    // A price range or several offers requires an explicit user choice.
    const offer = offers.length === 1 && offers[0]["@type"] !== "AggregateOffer" ? offers[0] : null;
    products.push({
      name: String(value.name ?? "").slice(0, 100),
      price: offer?.price == null ? null : String(offer.price).slice(0, 100),
      currency: String(offer?.priceCurrency ?? "").slice(0, 3),
      variant: String(value.sku ?? value.model ?? "").slice(0, 300),
    });
  };
  for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(
    0,
    20,
  )) {
    if (script.textContent.length > 100000) continue;
    try {
      add(JSON.parse(script.textContent));
    } catch {
      /* Invalid site metadata is optional. */
    }
  }
  const meta = (key) => document.querySelector(`meta[property="${key}"]`)?.content ?? "";
  if (!products.length && meta("product:price:amount"))
    products.push({
      name: meta("og:title"),
      price: meta("product:price:amount"),
      currency: meta("product:price:currency"),
      variant: "",
    });
  const root = document.querySelector('main, article, [itemtype$="/Product"]') ?? document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const snippets = [];
  let size = 0;
  let visited = 0;
  while (walker.nextNode() && visited++ < 3000 && size < 12000) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (
      !parent ||
      parent.closest(
        'script, style, noscript, nav, footer, form, input, textarea, select, [contenteditable], [hidden], [aria-hidden="true"]',
      )
    )
      continue;
    if (!parent.getClientRects().length || getComputedStyle(parent).visibility !== "visible")
      continue;
    const text = node.textContent.trim().replace(/\s+/g, " ").slice(0, 500);
    if (text) {
      snippets.push(text);
      size += text.length;
    }
  }
  return {
    url: location.href,
    title: (meta("og:title") || document.title).slice(0, 100),
    products,
    text: snippets.join("\n").slice(0, 12000),
  };
}
