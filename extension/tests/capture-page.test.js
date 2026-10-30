import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { capturePage } from "../src/capture-page.js";

function capture(html) {
  const dom = new JSDOM(html, { url: "https://shop.test/item" });
  const originals = Object.fromEntries(
    ["document", "location", "NodeFilter", "getComputedStyle"].map((key) => [key, globalThis[key]]),
  );
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 10, height: 10 }];
  try {
    return capturePage();
  } finally {
    Object.assign(globalThis, originals);
    dom.window.close();
  }
}

test("capture selects product fields and excludes forms, scripts and hidden content", () => {
  const snapshot = capture(
    `<title>Desk</title><script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Desk","description":"PRIVATE_METADATA","offers":{"@type":"Offer","price":"20","priceCurrency":"USD"}}]}</script><main><h1>Desk</h1><form><input value="PRIVATE_INPUT"><span>PRIVATE_FORM</span></form><script>PRIVATE_SCRIPT</script><p hidden>PRIVATE_HIDDEN</p><p>Visible product details</p></main>`,
  );
  assert.equal(snapshot.products[0].price, "20");
  assert.match(snapshot.text, /Visible product details/);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE/);
});

test("multiple offers and aggregate ranges cannot masquerade as a fixed price", () => {
  for (const offers of [
    [
      { "@type": "Offer", price: "10" },
      { "@type": "Offer", price: "20" },
    ],
    { "@type": "AggregateOffer", lowPrice: "10", highPrice: "20" },
  ]) {
    const data = JSON.stringify({ "@type": "Product", name: "Desk", offers });
    assert.equal(
      capture(`<script type="application/ld+json">${data}</script><main>Desk</main>`).products[0]
        .price,
      null,
    );
  }
});
