import {
  ensureAuthenticated,
  getToken,
  renderAuthHeader,
  getCachedScopes,
  recordScopesFromResponse,
  TOKEN_NEW_URL,
} from "./auth.js";

const ORG_AVATAR_CACHE = "metanorma-actions-dashboard.orgAvatars";
const UNSUB_KEY = "metanorma-actions-dashboard.unsubscribedOrgs";
const SUB_DISCOVERED_KEY = "metanorma-actions-dashboard.subscribedDiscoveredOrgs";
const DISCOVERED_CACHE_KEY = "metanorma-actions-dashboard.discoveredOrgs";
const DISCOVERED_TTL_MS = 24 * 60 * 60 * 1000;
const SCOPE_BANNER_DISMISSED_KEY = "metanorma-actions-dashboard.scopeBannerDismissed";

let ALL_ORGS = [];
let DISCOVERED_ORGS = [];

async function main() {
  await ensureAuthenticated();
  renderAuthHeader(document.getElementById("auth-header"));
  ALL_ORGS = await loadOrgs();
  DISCOVERED_ORGS = loadCachedDiscovered();
  renderScopeBanner();
  renderTiles();
  renderManagePanel();
  hydrateAvatars(visibleOrgs());
  refreshDiscoveredOrgs();
}

async function loadOrgs() {
  const res = await fetch("./orgs.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load orgs.json: ${res.status}`);
  const body = await res.json();
  return body.orgs;
}

function loadCachedDiscovered() {
  try {
    const raw = localStorage.getItem(DISCOVERED_CACHE_KEY);
    if (!raw) return [];
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.ts !== "number") return [];
    if (Date.now() - obj.ts > DISCOVERED_TTL_MS) return [];
    return Array.isArray(obj.orgs) ? obj.orgs : [];
  } catch (_) {
    return [];
  }
}

async function refreshDiscoveredOrgs() {
  const token = getToken();
  if (!token) return;
  const orgs = [];
  let url = "https://api.github.com/user/orgs?per_page=100";
  let lastRes = null;
  while (url) {
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
    } catch (_) {
      return;
    }
    if (!res.ok) return;
    lastRes = res;
    const page = await res.json();
    for (const o of page) orgs.push({ name: o.login });
    url = parseNextLink(res.headers.get("Link"));
  }
  if (lastRes) recordScopesFromResponse(lastRes);
  localStorage.setItem(DISCOVERED_CACHE_KEY, JSON.stringify({ ts: Date.now(), orgs }));
  DISCOVERED_ORGS = orgs;
  renderScopeBanner();
  renderManagePanel();
  renderTiles();
  hydrateAvatars(visibleOrgs());
}

function parseNextLink(header) {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
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

function readSubscribedDiscovered() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SUB_DISCOVERED_KEY) || "[]"));
  } catch (_) {
    return new Set();
  }
}

function writeSubscribedDiscovered(set) {
  localStorage.setItem(SUB_DISCOVERED_KEY, JSON.stringify([...set]));
}

function curatedNameSet() {
  return new Set(ALL_ORGS.map((o) => o.name));
}

function discoveredNonCurated() {
  const curated = curatedNameSet();
  return DISCOVERED_ORGS.filter((o) => !curated.has(o.name));
}

function visibleOrgs() {
  const unsub = readUnsubscribed();
  const sub = readSubscribedDiscovered();
  const curatedVisible = ALL_ORGS.filter((o) => !unsub.has(o.name));
  const discoveredVisible = discoveredNonCurated()
    .filter((o) => sub.has(o.name))
    .map((o) => ({ name: o.name, label: o.name }));
  return [...curatedVisible, ...discoveredVisible];
}

function renderTiles() {
  const grid = document.getElementById("org-grid");
  const cached = readAvatarCache();
  const visible = visibleOrgs();
  if (visible.length === 0) {
    grid.innerHTML = `<div class="empty-subs">You've unsubscribed from every org. Use the panel below to subscribe to one or more.</div>`;
    return;
  }
  grid.innerHTML = visible
    .map((org) => {
      const avatar = cached[org.name];
      const img = avatar
        ? `<img class="org-avatar" src="${avatar}" alt="" width="48" height="48">`
        : `<div class="org-avatar-placeholder" data-org="${escapeHtml(org.name)}"></div>`;
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
  const subDiscovered = readSubscribedDiscovered();
  const discovered = discoveredNonCurated();

  const curatedRows = ALL_ORGS.map((org) => `
    <label class="manage-row">
      <input type="checkbox" data-source="curated" data-org="${escapeHtml(org.name)}" ${unsub.has(org.name) ? "" : "checked"}>
      <span class="manage-label">${escapeHtml(org.label)}</span>
      <code class="manage-slug">${escapeHtml(org.name)}</code>
    </label>
  `).join("");

  const discoveredRows = discovered.map((org) => `
    <label class="manage-row">
      <input type="checkbox" data-source="discovered" data-org="${escapeHtml(org.name)}" ${subDiscovered.has(org.name) ? "checked" : ""}>
      <span class="manage-label">${escapeHtml(org.name)}</span>
    </label>
  `).join("");

  container.innerHTML = `
    <p class="manage-hint">Untick curated orgs you don't want to see, or tick your personal orgs to add them. Stored in this browser only; doesn't affect other viewers.</p>
    <div class="manage-section">
      <h3 class="manage-section-title">Curated orgs <span class="manage-section-count">(${ALL_ORGS.length})</span></h3>
      ${curatedRows}
    </div>
    ${discovered.length ? `
      <div class="manage-section">
        <h3 class="manage-section-title">Your other organizations <span class="manage-section-count">(${discovered.length})</span></h3>
        <p class="manage-hint-small">Pulled from your GitHub memberships. Unsubscribed by default; tick to add to the entry page.</p>
        ${discoveredRows}
      </div>
    ` : ""}
    <p class="manage-request">Want more orgs in the curated set? <a href="https://github.com/metanorma/dashboard/issues" target="_blank" rel="noopener">Lodge a request</a> in the <code>dashboard</code> repo.</p>
  `;

  container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const slug = cb.dataset.org;
      const source = cb.dataset.source;
      if (source === "curated") {
        const set = readUnsubscribed();
        if (cb.checked) set.delete(slug);
        else set.add(slug);
        writeUnsubscribed(set);
      } else {
        const set = readSubscribedDiscovered();
        if (cb.checked) set.add(slug);
        else set.delete(slug);
        writeSubscribedDiscovered(set);
      }
      renderTiles();
      hydrateAvatars(visibleOrgs());
    });
  });
}

function renderScopeBanner() {
  const el = document.getElementById("scope-banner");
  if (!el) return;
  const scopes = getCachedScopes();
  const hasReadOrg = scopes.has("read:org");
  const dismissed = localStorage.getItem(SCOPE_BANNER_DISMISSED_KEY) === "1";
  if (hasReadOrg || dismissed || scopes.size === 0) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <div class="scope-banner">
      <span class="scope-banner-text">Your token is missing the <code>read:org</code> scope, so personal-org discovery is limited to your public memberships. <a href="${TOKEN_NEW_URL}" target="_blank" rel="noopener">Regenerate the token →</a></span>
      <button type="button" class="scope-banner-dismiss" aria-label="Dismiss">×</button>
    </div>
  `;
  el.querySelector(".scope-banner-dismiss").addEventListener("click", () => {
    localStorage.setItem(SCOPE_BANNER_DISMISSED_KEY, "1");
    renderScopeBanner();
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
        img.width = 48;
        img.height = 48;
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
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

main().catch((err) => {
  const grid = document.getElementById("org-grid");
  grid.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
});
