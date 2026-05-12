import { ensureAuthenticated, getToken, renderAuthHeader } from "./auth.js";

const ORG_AVATAR_CACHE = "metanorma-actions-dashboard.orgAvatars";
const UNSUB_KEY = "metanorma-actions-dashboard.unsubscribedOrgs";

let ALL_ORGS = [];

async function main() {
  await ensureAuthenticated();
  renderAuthHeader(document.getElementById("auth-header"));
  ALL_ORGS = await loadOrgs();
  renderTiles();
  renderManagePanel();
  hydrateAvatars(ALL_ORGS);
}

async function loadOrgs() {
  const res = await fetch("./orgs.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load orgs.json: ${res.status}`);
  const body = await res.json();
  return body.orgs;
}

function readUnsubscribed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(UNSUB_KEY) || "[]"));
  } catch (_) {
    return new Set();
  }
}

function writeUnsubscribed(set) {
  localStorage.setItem(UNSUB_KEY, JSON.stringify([...set]));
}

function renderTiles() {
  const grid = document.getElementById("org-grid");
  const cached = readAvatarCache();
  const unsub = readUnsubscribed();
  const visible = ALL_ORGS.filter((o) => !unsub.has(o.name));
  if (visible.length === 0) {
    grid.innerHTML = `<div class="empty-subs">You've unsubscribed from every org. Use the panel below to subscribe to one or more.</div>`;
    return;
  }
  grid.innerHTML = visible
    .map((org) => {
      const avatar = cached[org.name];
      const img = avatar
        ? `<img class="org-avatar" src="${avatar}" alt="" width="64" height="64">`
        : `<div class="org-avatar-placeholder" data-org="${org.name}"></div>`;
      return `
        <a class="org-tile" href="./actions-dashboard.html?org=${encodeURIComponent(org.name)}">
          ${img}
          <span class="org-label">${escapeHtml(org.label)}</span>
          <span class="org-name">${escapeHtml(org.name)}</span>
        </a>
      `;
    })
    .join("");
}

function renderManagePanel() {
  const container = document.getElementById("manage-orgs");
  if (!container) return;
  const unsub = readUnsubscribed();
  container.innerHTML = `
    <p class="manage-hint">Untick orgs you don't want to see on this page. Stored in this browser only; doesn't affect other viewers.</p>
    ${ALL_ORGS.map((org) => `
      <label class="manage-row">
        <input type="checkbox" data-org="${escapeHtml(org.name)}" ${unsub.has(org.name) ? "" : "checked"}>
        <span class="manage-label">${escapeHtml(org.label)}</span>
        <code class="manage-slug">${escapeHtml(org.name)}</code>
      </label>
    `).join("")}
  `;
  container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const slug = cb.dataset.org;
      const set = readUnsubscribed();
      if (cb.checked) set.delete(slug);
      else set.add(slug);
      writeUnsubscribed(set);
      renderTiles();
    });
  });
}

async function hydrateAvatars(orgs) {
  const token = getToken();
  const cached = readAvatarCache();
  let updated = false;
  for (const org of orgs) {
    if (cached[org.name]) continue;
    try {
      const res = await fetch(`https://api.github.com/orgs/${org.name}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      if (!res.ok) continue;
      const body = await res.json();
      cached[org.name] = body.avatar_url;
      updated = true;
      const placeholder = document.querySelector(`.org-avatar-placeholder[data-org="${org.name}"]`);
      if (placeholder) {
        const img = document.createElement("img");
        img.className = "org-avatar";
        img.src = body.avatar_url;
        img.alt = "";
        img.width = 64;
        img.height = 64;
        placeholder.replaceWith(img);
      }
    } catch (_) {
      // best-effort
    }
  }
  if (updated) localStorage.setItem(ORG_AVATAR_CACHE, JSON.stringify(cached));
}

function readAvatarCache() {
  try {
    return JSON.parse(localStorage.getItem(ORG_AVATAR_CACHE) || "{}");
  } catch (_) {
    return {};
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

main().catch((err) => {
  const grid = document.getElementById("org-grid");
  grid.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
});
