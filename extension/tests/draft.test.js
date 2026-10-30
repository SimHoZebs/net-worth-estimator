import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appURL,
  newDraft,
  pageURL,
  parsePrice,
  purchaseRequest,
  serviceURL,
  suggestions,
} from "../src/draft.js";
import { CaptureState } from "../src/state.js";
import { memoryStorage } from "./storage.js";

test("normalize source URLs without removing variant parameters", () => {
  assert.equal(
    pageURL("https://shop.test/item?variant=red&utm_source=ad&gclid=x#reviews"),
    "https://shop.test/item?variant=red",
  );
  for (const value of ["javascript:alert(1)", "https://user:pass@shop.test/"])
    assert.throws(() => pageURL(value));
  assert.equal(appURL("http://127.0.0.1:8000/"), "http://127.0.0.1:8000");
  for (const value of ["http://lan.test", "https://app.test/path", "https://app.test/?token=x"])
    assert.throws(() => appURL(value));
  assert.equal(serviceURL("https://api.test/v1/"), "https://api.test/v1");
});

test("parse prices conservatively across common formats", () => {
  for (const [raw, expected] of [
    ["USD 1,299.95", "1299.95"],
    ["1.299,95 €", "1299.95"],
    ["99,50", "99.5"],
    ["$99", "99"],
    ["USD 0.01", "0.01"],
  ])
    assert.equal(parsePrice(raw), expected, raw);
  for (const raw of [
    "$12/mo",
    "$12 per month",
    "from $12",
    "$12–20",
    "$12 to $20",
    "$15 $20",
    "1.234",
    "0",
    "-20",
  ])
    assert.equal(parsePrice(raw), "", raw);
});

test("several products do not silently select a price", () => {
  assert.equal(
    suggestions({
      title: "Store",
      products: [
        { name: "A", price: 10 },
        { name: "B", price: 20 },
      ],
    }).cost,
    "",
  );
  const product = suggestions({ products: [{ name: "Desk", price: 99, currency: "CAD" }] });
  assert.equal(product.cost, "99");
  assert.equal(product.currency, "");
});

test("purchase request requires explicit currency and current funding choices", () => {
  const draft = {
    ...newDraft(),
    name: "Desk",
    cost: "12.34",
    fromId: "cash",
    currency: "USD",
    startDate: "2026-10-30",
  };
  assert.deepEqual(purchaseRequest(draft, [{ id: "cash" }], [{ priority: 4 }]), {
    id: draft.id,
    name: "Desk",
    fundingAccountId: "cash",
    cost: 12.34,
    earliestDate: "2026-10-30",
    priority: 5,
    enabled: true,
  });
  assert.throws(() => purchaseRequest({ ...draft, currency: "" }, [{ id: "cash" }]));
  assert.throws(() => purchaseRequest(draft, []));
  assert.throws(() => purchaseRequest({ ...draft, cost: "1.234" }, [{ id: "cash" }]));
  assert.throws(() => purchaseRequest({ ...draft, startDate: "2026-02-30" }, [{ id: "cash" }]));
  assert.throws(
    () =>
      purchaseRequest(
        draft,
        [{ id: "cash" }],
        Array.from({ length: 100 }, () => ({ priority: 0 })),
      ),
    /queue is full/,
  );
});

test("late suggestions preserve user edits and drafts survive a new state instance", async () => {
  const storage = memoryStorage();
  const state = new CaptureState(storage);
  const original = (await state.read()).draft;
  await state.edit({ name: "My choice", cost: "42" });
  await state.suggest(
    {
      name: "AI title",
      cost: "19",
      priceText: "$19",
      nameMethod: "ai",
      priceMethod: "ai",
      currency: "USD",
    },
    original,
    original.id,
  );
  const saved = (await new CaptureState(storage).read()).draft;
  assert.equal(saved.name, "My choice");
  assert.equal(saved.cost, "42");
  assert.equal(saved.nameMethod, "manual");
  await state.change((current) => {
    current.pendingSave = { payload: "stable" };
  });
  await assert.rejects(state.edit({ cost: "12" }), /pending save/);
});
