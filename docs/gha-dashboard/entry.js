import { ensureAuthenticated, getToken, renderAuthHeader } from "./auth.js";

const ORG_AVATAR_CACHE = "metanorma-actions-dashboard.orgAvatars";

async function main() {
  await ensureAuthenticated();
  renderAuthHeader(document.getElementById("auth-header"));
  const orgs = await loadOrgs();
  renderTiles(orgs);
  hydrateAvatars(orgs);
}

async function loadOrgs() {
  const res = await fetch("./orgs.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load orgs.json: ${res.status}`);
  const body = await res.json();
  return body.orgs;
}

function renderTiles(orgs) {
  const grid = document.getElementById("org-grid");
  const cached = readAvatarCache();
  grid.innerHTML = orgs
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
