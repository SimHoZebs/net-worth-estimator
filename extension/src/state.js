import { newDraft } from "./draft.js";

export class CaptureState {
  constructor(storage) {
    this.storage = storage;
    this.queue = Promise.resolve();
    this.ready = this.initialize();
  }

  async initialize() {
    const { captureState } = await this.storage.local.get("captureState");
    if (!captureState) await this.storage.local.set({ captureState: { draft: newDraft() } });
  }

  async read() {
    await this.ready;
    return (await this.storage.local.get("captureState")).captureState;
  }

  change(update) {
    const result = this.queue.then(async () => {
      const state = await this.read();
      await update(state);
      // Replace one object atomically. storage.set merges top-level keys, so
      // deleting a property from a multi-key snapshot would retain stale saves.
      await this.storage.local.set({ captureState: state });
      return state;
    });
    this.queue = result.catch(() => {});
    return result;
  }

  async edit(values) {
    return this.change((state) => {
      if (state.pendingSave || state.saved?.id === state.draft.id)
        throw new Error("Retry the pending save, or start a new capture before editing.");
      for (const key of [
        "name",
        "cost",
        "currency",
        "fromId",
        "startDate",
        "variant",
        "sourceUrl",
      ]) {
        if (typeof values[key] === "string")
          state.draft[key] = values[key].slice(0, key === "sourceUrl" ? 2048 : 300);
      }
      if ("name" in values) state.draft.nameMethod = "manual";
      if ("cost" in values) {
        state.draft.priceMethod = "manual";
        if (!state.draft.sourceUrl) state.draft.priceText = values.cost.slice(0, 500);
      }
      if ("currency" in values) state.draft.priceMethod = "manual";
      if ("cost" in values || "currency" in values) delete state.captureProblem;
    });
  }

  async suggest(values, expected, draftID, sourceUrl) {
    return this.change((state) => {
      if (state.pendingSave || state.saved?.id === state.draft.id || state.draft.id !== draftID)
        return;
      if (sourceUrl) {
        state.draft.sourceUrl = sourceUrl;
        state.draft.capturedAt = new Date().toISOString();
      }
      delete state.captureProblem;
      if (values.priceMethod === "picker" && !values.cost)
        state.captureProblem =
          "The selected element does not contain one fixed full price. Enter the cost manually.";
      if (
        expected.name === state.draft.name &&
        values.name &&
        (!state.draft.name || state.draft.nameMethod !== "manual" || values.nameMethod === "picker")
      ) {
        state.draft.name = values.name;
        state.draft.nameMethod = values.nameMethod;
      }
      if (
        expected.cost === state.draft.cost &&
        values.cost &&
        (!state.draft.cost ||
          state.draft.priceMethod !== "manual" ||
          values.priceMethod === "picker")
      ) {
        state.draft.cost = values.cost;
        state.draft.priceText = values.priceText;
        state.draft.priceMethod = values.priceMethod;
        state.draft.currency = values.currency;
      }
      if (!state.draft.variant && values.variant) state.draft.variant = values.variant;
    });
  }
}
