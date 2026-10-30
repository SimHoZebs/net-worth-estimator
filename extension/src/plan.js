// Use the same reads as the app. Keep the financial document in worker memory,
// never in page context, AI requests, or persistent extension storage.
export async function loadPlan(connection, resource) {
  const [model, status] = await Promise.all([
    connection.api("/v1/financial-model", undefined, resource),
    connection.api("/v1/status", undefined, resource),
  ]);
  return {
    accounts: (model.document?.accounts ?? [])
      .filter((account) => account.enabled && !account.archived && account.kind !== "debt")
      .map(({ id, name }) => ({ id, name })),
    purchases: model.document?.plannedPurchases ?? [],
    readOnly: status.readOnly,
  };
}

export function matchesPurchase(stored, payload) {
  return (
    stored?.id === payload.id &&
    stored.name === payload.name &&
    stored.fundingAccountId === payload.fundingAccountId &&
    stored.cost === payload.cost &&
    stored.earliestDate === payload.earliestDate &&
    stored.priority === payload.priority &&
    stored.enabled === payload.enabled
  );
}
