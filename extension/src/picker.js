// Self-contained isolated-world script. The only result is a bounded field value.
export function pickElement(field, nonce) {
  globalThis.__waypointPickCleanup?.();
  const overlay = document.createElement("div");
  overlay.setAttribute("role", "status");
  overlay.textContent = `Waypoint: select ${field === "name" ? "a product name" : "the full price"}. Tab and Enter also work. Escape cancels.`;
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "12px 12px auto",
    padding: "16px",
    background: "#173c33",
    color: "#fff",
    font: "16px system-ui",
    zIndex: "2147483647",
    pointerEvents: "none",
    borderRadius: "8px",
  });
  document.documentElement.append(overlay);
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    pointerEvents: "none",
    border: "3px solid #c37c38",
    zIndex: "2147483646",
  });
  document.documentElement.append(box);
  let target;
  const highlight = (element) => {
    if (!(element instanceof HTMLElement) || element === overlay) return;
    target = element;
    const rect = target.getBoundingClientRect();
    Object.assign(box.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  };
  const move = (event) => highlight(event.target);
  const cleanup = () => {
    box.remove();
    overlay.remove();
    document.removeEventListener("pointerover", move, true);
    document.removeEventListener("click", select, true);
    document.removeEventListener("keydown", key, true);
    delete globalThis.__waypointPickCleanup;
  };
  const finish = (value) => {
    cleanup();
    chrome.runtime
      .sendMessage({ kind: "pick.result", field, nonce, value, url: location.href })
      .catch(() => {});
  };
  const choose = (element) => {
    if (
      !(element instanceof HTMLElement) ||
      element.closest("input, textarea, select, [contenteditable], form")
    ) {
      finish("");
      return;
    }
    finish((element.innerText || element.textContent || "").trim().slice(0, 500));
  };
  function select(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    choose(event.target);
  }
  function key(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      finish("");
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      choose(document.activeElement === document.body ? target : document.activeElement);
    }
    if (event.key === "Tab") requestAnimationFrame(() => highlight(document.activeElement));
  }
  document.addEventListener("pointerover", move, true);
  document.addEventListener("click", select, true);
  document.addEventListener("keydown", key, true);
  globalThis.__waypointPickCleanup = cleanup;
}
