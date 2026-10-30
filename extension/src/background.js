import { Connection } from "./connection.js";
import { CaptureState } from "./state.js";
import { appURL, newDraft, pageURL, parsePrice, serviceURL, suggestions } from "./draft.js";
import { capturePage } from "./capture-page.js";
import { pickElement } from "./picker.js";
import { autofill } from "./ai.js";
import { createPurchaseSaver } from "./save.js";
import { loadModel } from "./model.js";

const storage = chrome.storage;
const ready = Promise.all([
  storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
]);
const connection = new Connection(storage);
const captures = new CaptureState(storage);
const save = createPurchaseSaver(connection, captures, storage);

function useExtensionWindow() {
  chrome.action.onClicked.addListener(() =>
    chrome.windows.create({
      url: chrome.runtime.getURL("panel.html"),
      type: "popup",
      width: 420,
      height: 800,
    }),
  );
}
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(useExtensionWindow);
} else useExtensionWindow();

async function publicState() {
  const state = await captures.read();
  const { identity, pendingLogin, aiKey } = await storage.session.get([
    "identity",
    "pendingLogin",
    "aiKey",
  ]);
  const { connection: connected } = await storage.local.get("connection");
  return {
    draft: state.draft,
    settings: state.settings ?? {},
    pendingSave: Boolean(state.pendingSave),
    saved: state.saved,
    captureProblem: state.captureProblem,
    hasConnection: Boolean(connected),
    aiReady: Boolean(aiKey),
    identity: identity
      ? {
          name: identity.user?.name || identity.user?.subject || "Your account",
          resource: identity.resource.id,
          canWrite: identity.resource.permissions.includes("user:write"),
        }
      : null,
    pendingLogin: pendingLogin
      ? { userCode: pendingLogin.userCode, verificationUri: pendingLogin.verificationUri }
      : null,
  };
}

async function loadConnection() {
  const identity = await connection.identity();
  const resource = identity.resource.id;
  const model = await loadModel(connection, resource);
  await captures.change((state) => {
    const scope = `${state.settings?.app}|${resource}`;
    if (state.financialScope !== scope && !state.pendingSave) state.draft.fromId = "";
    state.financialScope = scope;
  });
  return { ...(await publicState()), accounts: model.accounts, readOnly: model.readOnly };
}

async function activePage() {
  const window = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
  if (!tab?.id || !tab.url)
    throw new Error("Open the extension from the toolbar on an HTTP/S product page.");
  pageURL(tab.url);
  return tab;
}

async function snapshotPage() {
  const tab = await activePage();
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: capturePage,
    });
    return { tab, snapshot: result.result };
  } catch {
    throw new Error(
      "Page access expired or this page is restricted. Click the extension toolbar button on the product page again. Manual entry still works.",
    );
  }
}

async function picked(message, sender) {
  const { picker } = await storage.session.get("picker");
  if (
    !picker ||
    sender.frameId !== 0 ||
    sender.tab?.id !== picker.tabId ||
    message.nonce !== picker.nonce ||
    message.field !== picker.field ||
    pageURL(sender.url) !== picker.url
  )
    return;
  await storage.session.remove("picker");
  const value = String(message.value ?? "").slice(0, 500);
  if (!value) return;
  const values =
    picker.field === "name"
      ? { name: value.slice(0, 100), nameMethod: "picker" }
      : {
          cost: parsePrice(value),
          priceText: value,
          priceMethod: "picker",
          currency: /\bUSD\b/.test(value) ? "USD" : "",
        };
  await captures.suggest(values, picker.expected, picker.draftID, picker.url);
}

async function handle(message) {
  switch (message.kind) {
    case "state":
      return publicState();
    case "connection.load":
      return loadConnection();
    case "auth.start": {
      const state = await captures.read();
      const login = await connection.start(state.settings?.app);
      await chrome.tabs.create({ url: login.verificationUri });
      return publicState();
    }
    case "auth.poll":
      return (await connection.poll()) ? loadConnection() : publicState();
    case "auth.disconnect":
      await connection.disconnect();
      return publicState();
    case "draft.edit":
      await captures.edit(message.values ?? {});
      return publicState();
    case "draft.new": {
      const state = await captures.read();
      if (state.pendingSave && !message.confirmed)
        throw new Error("A save may already exist. Retry it before starting another capture.");
      await captures.change((current) => {
        current.draft = newDraft();
        delete current.saved;
        delete current.pendingSave;
        delete current.captureProblem;
      });
      await storage.session.remove(["snapshot", "picker"]);
      return publicState();
    }
    case "settings.save": {
      const app = appURL(message.app);
      const base = message.aiBase ? serviceURL(message.aiBase) : "";
      const state = await captures.read();
      if (state.settings?.app !== app) await connection.disconnect();
      await captures.change((current) => {
        current.settings = {
          app,
          ai: {
            base,
            model: String(message.model ?? "")
              .trim()
              .slice(0, 200),
          },
        };
      });
      if (typeof message.key === "string") {
        if (message.key) await storage.session.set({ aiKey: message.key.slice(0, 4096) });
        else await storage.session.remove("aiKey");
      }
      return publicState();
    }
    case "page.capture": {
      const before = await captures.read();
      const { snapshot, tab } = await snapshotPage();
      const url = pageURL(snapshot.url);
      await storage.session.set({
        snapshot: { ...snapshot, url, draftID: before.draft.id, tabId: tab.id },
      });
      await captures.suggest(
        suggestions(snapshot),
        message.expected ?? before.draft,
        before.draft.id,
        url,
      );
      return publicState();
    }
    case "page.pick": {
      if (!["name", "cost"].includes(message.field)) throw new Error("Choose a capture field.");
      const state = await captures.read();
      if (state.pendingSave || state.saved?.id === state.draft.id)
        throw new Error("Start a new capture before selecting page details.");
      const tab = await activePage();
      const nonce = crypto.randomUUID();
      await storage.session.set({
        picker: {
          nonce,
          field: message.field,
          tabId: tab.id,
          draftID: state.draft.id,
          expected: message.expected ?? state.draft,
          url: pageURL(tab.url),
        },
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: pickElement,
        args: [message.field, nonce],
      });
      return publicState();
    }
    case "ai.fill": {
      const state = await captures.read();
      const { snapshot, aiKey } = await storage.session.get(["snapshot", "aiKey"]);
      if (!snapshot || snapshot.draftID !== state.draft.id)
        throw new Error("Capture this page before using AI autofill.");
      const values = await autofill(state.settings?.ai ?? {}, aiKey, snapshot);
      await captures.suggest(values, message.expected ?? state.draft, state.draft.id);
      return publicState();
    }
    case "purchase.save":
      await save();
      return publicState();
    default:
      throw new Error("Unsupported extension action.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.kind === "pick.result" && sender.tab) {
    ready
      .then(() => picked(message, sender))
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (sender.url !== chrome.runtime.getURL("panel.html")) return false;
  ready
    .then(() => handle(message))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error.message || "The action failed. Your draft remains available.",
      }),
    );
  return true;
});
