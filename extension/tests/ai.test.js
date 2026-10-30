import { test } from "node:test";
import assert from "node:assert/strict";
import { autofill } from "../src/ai.js";

test("AI receives bounded product evidence and uses structured output", async () => {
  let sent;
  const result = await autofill(
    { base: "https://api.test/v1", model: "chosen-model" },
    "secret",
    { title: "Desk", text: "x".repeat(20000), accounts: ["PRIVATE"] },
    async (url, options) => {
      assert.equal(url, "https://api.test/v1/chat/completions");
      sent = JSON.parse(options.body);
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: "<script>Desk</script>",
                priceText: "$129.99",
                currency: null,
              }),
            },
          },
        ],
      });
    },
  );
  assert.equal(sent.response_format.type, "json_schema");
  const data = JSON.parse(sent.messages[1].content);
  assert.equal(data.text.length, 12000);
  assert.equal(data.accounts, undefined);
  assert.equal(result.currency, "");
  assert.equal(result.cost, "129.99");
});

test("quota and malformed results recover without another provider call", async () => {
  await assert.rejects(
    autofill(
      { base: "https://api.test", model: "m" },
      "key",
      {},
      async () => new Response("", { status: 429 }),
    ),
    /quota/,
  );
  await assert.rejects(
    autofill({ base: "https://api.test", model: "m" }, "key", {}, async () =>
      Response.json({ choices: [] }),
    ),
    /invalid/,
  );
});
