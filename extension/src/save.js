import { purchaseRequest } from "./draft.js";
import { loadModel, matchesPurchase } from "./model.js";

// Own the uncertain-save state and single-flight write. UI and extraction never
// construct row writes or choose retry identities independently.
export function createPurchaseSaver(connection, captures, storage) {
  let saving;
  return async function save() {
    if (saving) return saving;
    saving = perform().finally(() => {
      saving = null;
    });
    return saving;
  };

  async function perform() {
    const identity = await connection.identity();
    const resource = identity.resource.id;
    const model = await loadModel(connection, resource);
    if (model.readOnly || !identity.resource.permissions.includes("user:write"))
      throw new Error("This account is read-only. Your draft remains available.");
    const { connection: connected } = await storage.local.get("connection");
    if (!connected) throw new Error("Reconnect before saving this purchase.");
    const state = await captures.read();
    if (state.captureProblem) throw new Error(state.captureProblem);
    if (state.saved?.id === state.draft.id) return;
    if (
      state.pendingSave &&
      (state.pendingSave.base !== connected.base || state.pendingSave.resource !== resource)
    )
      throw new Error(
        "The pending save belongs to another account or app. Reconnect that account to retry.",
      );
    if (!state.pendingSave && state.financialScope !== `${connected.base}|${resource}`)
      throw new Error(
        "The connected account changed. Reopen the panel and choose its funding account before saving.",
      );
    const payload =
      state.pendingSave?.payload ?? purchaseRequest(state.draft, model.accounts, model.purchases);
    await captures.change((current) => {
      if (current.draft.id !== state.draft.id)
        throw new Error("The draft changed. Review it before saving.");
      current.pendingSave = { payload, resource, base: connected.base };
    });
    const clearPending = () =>
      captures.change((current) => {
        if (current.pendingSave?.payload.id === payload.id) delete current.pendingSave;
      });
    let result;
    try {
      result = await connection.api("/v1/planned-purchases", payload, resource);
    } catch (error) {
      if (error.status === 409) {
        const response = await connection.api("/v1/financial-model", undefined, resource);
        const stored = response.model?.plannedPurchases?.find(
          (purchase) => purchase.id === payload.id,
        );
        if (!matchesPurchase(stored, payload))
          throw new Error(
            "This purchase ID conflicts with saved data. Check Waypoint before starting another capture.",
          );
        result = { persisted: true };
      } else {
        // A rejection is definitive. A timeout/5xx can follow a successful commit.
        if (!state.pendingSave && [400, 403, 413, 422].includes(error.status)) await clearPending();
        throw error;
      }
    }
    if (!result.persisted) {
      if (!state.pendingSave) await clearPending();
      throw new Error(
        result.issues
          ?.filter((issue) => issue.severity === "error")
          .map((issue) => issue.message)
          .join(" ") || "The app rejected this purchase. Check its fields.",
      );
    }
    await captures.change((current) => {
      if (current.draft.id === payload.id)
        current.saved = { id: payload.id, name: payload.name, base: connected.base };
      if (current.pendingSave?.payload.id === payload.id) delete current.pendingSave;
    });
  }
}
