import { appURL, serviceURL } from "./draft.js";

const $ = (id) => document.getElementById(id);
const fields = ["name", "cost", "currency", "fromId", "startDate", "sourceUrl", "variant"];
let state;
let accounts = [];
let busySave = false;
let settingsLoaded = false;
let keyChanged = false;
let edits = Promise.resolve();
let polling;

async function send(kind, values = {}) {
  const result = await chrome.runtime.sendMessage({ kind, ...values });
  if (!result?.ok)
    throw new Error(result?.error || "The extension did not respond. Reopen the panel.");
  return result.data;
}

function error(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}
function status(message) {
  $("status").textContent = message;
}

function render(next) {
  state = next;
  if (next.captureProblem) error(next.captureProblem);
  if (next.accounts) {
    accounts = next.accounts;
    $("fromId").replaceChildren(
      new Option(
        accounts.length
          ? "Choose an account"
          : "No eligible funding accounts. Add one in Waypoint.",
        "",
      ),
      ...accounts.map((account) => new Option(account.name, account.id)),
    );
  }
  for (const field of fields) {
    if (document.activeElement !== $(field)) $(field).value = state.draft[field] ?? "";
  }
  $("identity").textContent = state.identity
    ? `Connected · ${state.identity.name}`
    : state.hasConnection
      ? "Connection needs verification"
      : "Not connected";
  $("connect").hidden = Boolean(state.identity);
  $("disconnect").hidden = !state.hasConnection && !state.pendingLogin;
  $("connect").textContent = state.hasConnection ? "Reconnect" : "Connect";
  $("approval").hidden = !state.pendingLogin;
  if (state.pendingLogin) {
    $("user-code").textContent = state.pendingLogin.userCode;
    $("approval-link").href = state.pendingLogin.verificationUri;
  }
  $("success").hidden = !state.saved;
  if (state.saved) {
    $("saved-name").textContent = state.saved.name;
    $("view-purchase").href = `${state.saved.base}/#purchases`;
  }
  const saved = state.saved?.id === state.draft.id;
  $("purchase-fields").disabled = state.pendingSave || saved || busySave;
  $("save").disabled = saved || busySave;
  $("save").textContent = state.pendingSave
    ? "Retry the same save ↗"
    : saved
      ? "Added to your financial model"
      : "Add planned purchase ↗";
  $("autofill").disabled = !state.aiReady;
  $("name-source").textContent = `Source: ${state.draft.nameMethod}`;
  $("cost-source").textContent = `Source: ${state.draft.priceMethod}`;
  $("original-price").textContent = state.draft.priceText
    ? `Original price text: ${state.draft.priceText}`
    : "";
  if (!settingsLoaded) {
    $("app").value = state.settings.app ?? "";
    $("ai-base").value = state.settings.ai?.base ?? "";
    $("model").value = state.settings.ai?.model ?? "";
    $("settings").open = !state.settings.app;
    settingsLoaded = true;
  }
  $("key").placeholder = state.aiReady ? "Key present for this browser session" : "No key saved";
  if (state.pendingLogin && !polling) polling = setInterval(poll, 5000);
  if (!state.pendingLogin && polling) {
    clearInterval(polling);
    polling = null;
  }
}

async function act(button, action, message) {
  button.disabled = true;
  error("");
  status(message);
  try {
    render(await action());
    status("");
  } catch (failure) {
    error(failure.message);
    status("");
    render(await send("state"));
  } finally {
    button.disabled = false;
    if (state) render(state);
  }
}

async function poll() {
  try {
    render(await send("auth.poll"));
  } catch (failure) {
    clearInterval(polling);
    polling = null;
    error(failure.message);
  }
}

for (const field of fields) {
  $(field).addEventListener("input", () => {
    error("");
    const value = $(field).value;
    edits = edits
      .then(() => send("draft.edit", { values: { [field]: value } }))
      .catch((failure) => error(failure.message));
  });
}
$("key").addEventListener("input", () => {
  keyChanged = true;
});
$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  await act(
    button,
    async () => {
      const app = appURL($("app").value);
      const base = $("ai-base").value ? serviceURL($("ai-base").value) : "";
      const origins = [new URL(app).origin + "/*", ...(base ? [new URL(base).origin + "/*"] : [])];
      if (!(await chrome.permissions.request({ origins })))
        throw new Error("Host access is required for the app and your selected AI provider.");
      const key = $("forget-key").checked ? "" : keyChanged ? $("key").value : undefined;
      const next = await send("settings.save", {
        app,
        aiBase: base,
        model: $("model").value,
        ...(key === undefined ? {} : { key }),
      });
      $("key").value = "";
      keyChanged = false;
      $("forget-key").checked = false;
      return next;
    },
    "Save connection settings…",
  );
});
$("connect").addEventListener("click", () =>
  act(
    $("connect"),
    async () => {
      if (!state.settings.app) {
        $("settings").open = true;
        $("app").focus();
        throw new Error("Save your Waypoint app URL first.");
      }
      return send("auth.start");
    },
    "Open the sign-in approval page…",
  ),
);
$("disconnect").addEventListener("click", () =>
  act(
    $("disconnect"),
    async () => {
      accounts = [];
      $("fromId").replaceChildren(new Option("Connect to choose an account", ""));
      return send("auth.disconnect");
    },
    "Disconnect this browser…",
  ),
);
$("capture").addEventListener("click", () =>
  act(
    $("capture"),
    async () => {
      await edits;
      return send("page.capture", { expected: { name: $("name").value, cost: $("cost").value } });
    },
    "Read product details from this page…",
  ),
);
$("autofill").addEventListener("click", () =>
  act(
    $("autofill"),
    async () => {
      await edits;
      return send("ai.fill", { expected: { name: $("name").value, cost: $("cost").value } });
    },
    "Ask your provider for product suggestions…",
  ),
);
for (const button of document.querySelectorAll("[data-pick]"))
  button.addEventListener("click", () =>
    act(
      button,
      async () => {
        await edits;
        return send("page.pick", {
          field: button.dataset.pick,
          expected: { name: $("name").value, cost: $("cost").value },
        });
      },
      "Select the element on the page. Escape cancels.",
    ),
  );
$("purchase").addEventListener("submit", async (event) => {
  event.preventDefault();
  await edits;
  busySave = true;
  await act($("save"), () => send("purchase.save"), "Save this reviewed purchase…");
  busySave = false;
  render(state);
});
$("new-capture").addEventListener("click", () =>
  act(
    $("new-capture"),
    () => {
      if (
        state.pendingSave &&
        !confirm(
          "The previous save may already exist. Retry is safer. Discard its retry record and start another capture?",
        )
      )
        return Promise.resolve(state);
      return send("draft.new", { confirmed: true });
    },
    "Start a new capture…",
  ),
);
$("open-app").addEventListener("click", (event) => {
  event.preventDefault();
  if (state.settings.app) chrome.tabs.create({ url: `${state.settings.app}/#purchases` });
  else {
    $("settings").open = true;
    $("app").focus();
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.captureState && document.activeElement?.tagName !== "INPUT")
    send("state")
      .then(render)
      .catch(() => {});
});
document.addEventListener("focusout", (event) => {
  const element = event.target;
  if (element.matches?.("input, select"))
    element.setAttribute("aria-invalid", String(element.matches(":user-invalid")));
});

try {
  render(await send("state"));
  if (state.hasConnection) render(await send("connection.load"));
} catch (failure) {
  error(failure.message);
}
