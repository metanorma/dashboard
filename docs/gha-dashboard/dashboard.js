import { ensureAuthenticated, getToken, renderAuthHeader } from "./auth.js";

const REPO_CACHE_PREFIX = "metanorma-actions-dashboard.repos.";
const ETAG_CACHE_PREFIX = "metanorma-actions-dashboard.etag.";
const STATUSES = ["in_progress", "queued"];
const CONCURRENCY = 8;
const REFRESH_INTERVALS = { off: 0, "15s": 15000, "30s": 30000, "60s": 60000 };

const state = {
  org: null,
  repos: [],
  rows: [],
  sort: { key: "elapsed", dir: "desc" },
  filter: { text: "", in_progress: true, queued: true },
  rateLimit: { remaining: null, limit: null, reset: null },
  autoRefreshTimer: null,
  // ETag bodies: { [`${org}/${repo}/${status}`]: { etag, runs } }
  etagBodies: new Map(),
};

async function main() {
  const params = new URLSearchParams(location.search);
  const org = params.get("org");
  if (!org) return showError("Missing ?org= parameter.");

  const allowed = await loadAllowedOrgs();
  if (!allowed.includes(org)) {
    return showError(
      `Unknown org "${org}". Edit docs/gha-dashboard/orgs.json to add it.`,
    );
  }
  state.org = org;
  document.title = `${org} — active runs`;
  document.getElementById("org-title").textContent = `${org} — active runs`;

  await ensureAuthenticated();
  renderAuthHeader(document.getElementById("auth-header"));

  wireControls();
  await initialLoad();
}

async function loadAllowedOrgs() {
  const res = await fetch("./orgs.json", { cache: "no-cache" });
  const body = await res.json();
  return body.orgs.map((o) => o.name);
}

function wireControls() {
  document.getElementById("refresh-now").addEventListener("click", () => poll());
  document.getElementById("rescan-org").addEventListener("click", () => initialLoad());
  document.getElementById("auto-refresh").addEventListener("change", (e) => setAutoRefresh(e.target.value));
  const filterText = document.getElementById("filter-text");
  filterText.addEventListener("input", (e) => {
    state.filter.text = e.target.value.toLowerCase();
    renderTable();
  });
  document.getElementById("filter-in-progress").addEventListener("change", (e) => {
    state.filter.in_progress = e.target.checked;
    renderTable();
  });
  document.getElementById("filter-queued").addEventListener("change", (e) => {
    state.filter.queued = e.target.checked;
    renderTable();
  });
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      else state.sort = { key, dir: key === "elapsed" || key === "started" ? "desc" : "asc" };
      renderTable();
    });
  });
  setInterval(tickElapsed, 1000);
}

async function initialLoad() {
  setStatus("Loading repo list…");
  state.etagBodies = new Map();
  try {
    state.repos = await fetchOrgRepos(state.org);
    sessionStorage.setItem(REPO_CACHE_PREFIX + state.org, JSON.stringify(state.repos));
  } catch (err) {
    return showError(`Failed to enumerate repos in ${state.org}: ${err.message}`);
  }
  await poll();
}

async function fetchOrgRepos(org) {
  const token = getToken();
  const repos = [];
  let url = `https://api.github.com/orgs/${org}/repos?per_page=100&type=all`;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    updateRateLimit(res);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const page = await res.json();
    for (const r of page) {
      if (r.archived || r.disabled) continue;
      repos.push({ name: r.name, html_url: r.html_url });
    }
    url = parseNextLink(res.headers.get("Link"));
  }
  return repos;
}

function parseNextLink(header) {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

async function poll() {
  if (!state.repos.length) return;
  setStatus(`Polling ${state.repos.length} ${state.org} repos…`);
  const tasks = [];
  for (const repo of state.repos) {
    for (const status of STATUSES) {
      tasks.push({ repo, status });
    }
  }
  const results = await parallelLimit(tasks, CONCURRENCY, async ({ repo, status }) => {
    return fetchRunsForRepo(state.org, repo.name, status);
  });
  const rows = [];
  for (let i = 0; i < tasks.length; i++) {
    const { repo, status } = tasks[i];
    const runs = results[i];
    if (!runs) continue;
    for (const run of runs) {
      rows.push(rowFromRun(repo, run, status));
    }
  }
  state.rows = rows;
  setStatus(`Refreshed ${new Date().toLocaleTimeString()}`);
  renderTable();
}

async function fetchRunsForRepo(org, repo, status) {
  const token = getToken();
  const url = `https://api.github.com/repos/${org}/${repo}/actions/runs?status=${status}&per_page=30`;
  const cacheKey = `${org}/${repo}/${status}`;
  const cached = state.etagBodies.get(cacheKey);
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
  if (cached) headers["If-None-Match"] = cached.etag;
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (_) {
    return cached ? cached.runs : [];
  }
  updateRateLimit(res);
  if (res.status === 304 && cached) return cached.runs;
  if (!res.ok) return cached ? cached.runs : [];
  const etag = res.headers.get("ETag");
  const body = await res.json();
  const runs = body.workflow_runs || [];
  if (etag) state.etagBodies.set(cacheKey, { etag, runs });
  return runs;
}

function rowFromRun(repo, run, status) {
  const isPR = run.event === "pull_request" && run.pull_requests && run.pull_requests.length;
  const ref = isPR ? `PR #${run.pull_requests[0].number}` : run.head_branch || run.head_sha.slice(0, 7);
  return {
    repo: repo.name,
    repo_url: repo.html_url,
    workflow: run.name || run.path,
    workflow_url: `${repo.html_url}/actions/workflows/${pathToFile(run.path)}`,
    run_number: run.run_number,
    run_url: run.html_url,
    ref,
    ref_url: isPR
      ? run.pull_requests[0].url.replace("api.github.com/repos", "github.com").replace("/pulls/", "/pull/")
      : `${repo.html_url}/tree/${encodeURIComponent(run.head_branch || run.head_sha)}`,
    event: run.event,
    actor: run.actor ? { login: run.actor.login, avatar_url: run.actor.avatar_url, html_url: run.actor.html_url } : null,
    status,
    started_at: run.run_started_at || run.created_at,
  };
}

function pathToFile(p) {
  if (!p) return "";
  const slash = p.lastIndexOf("/");
  return slash >= 0 ? p.slice(slash + 1) : p;
}

async function parallelLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i]);
      } catch (_) {
        results[i] = null;
      }
    }
  });
  await Promise.all(runners);
  return results;
}

function updateRateLimit(res) {
  const remaining = res.headers.get("X-RateLimit-Remaining");
  const limit = res.headers.get("X-RateLimit-Limit");
  const reset = res.headers.get("X-RateLimit-Reset");
  if (remaining !== null) state.rateLimit.remaining = parseInt(remaining, 10);
  if (limit !== null) state.rateLimit.limit = parseInt(limit, 10);
  if (reset !== null) state.rateLimit.reset = parseInt(reset, 10);
  renderRateLimit();
}

function renderRateLimit() {
  const el = document.getElementById("rate-limit");
  if (state.rateLimit.remaining === null) {
    el.textContent = "";
    return;
  }
  const resetsIn = state.rateLimit.reset ? Math.max(0, Math.round((state.rateLimit.reset * 1000 - Date.now()) / 60000)) : null;
  const resetStr = resetsIn !== null ? ` — resets in ${resetsIn}m` : "";
  el.textContent = `Rate-limit: ${state.rateLimit.remaining} / ${state.rateLimit.limit}${resetStr}`;
}

function renderTable() {
  const visible = state.rows.filter((r) => {
    if (r.status === "in_progress" && !state.filter.in_progress) return false;
    if (r.status === "queued" && !state.filter.queued) return false;
    if (state.filter.text) {
      const hay = `${r.repo} ${r.workflow}`.toLowerCase();
      if (!hay.includes(state.filter.text)) return false;
    }
    return true;
  });
  visible.sort(comparator(state.sort));

  const activeRepos = new Set(visible.map((r) => r.repo));
  const totalRepos = state.repos.length;

  const tbody = document.querySelector("#runs tbody");
  if (visible.length === 0) {
    tbody.innerHTML = "";
    document.getElementById("empty-state").style.display = "block";
    document.getElementById("empty-count").textContent = `0 active runs across ${totalRepos} ${state.org} repos`;
    return;
  }
  document.getElementById("empty-state").style.display = "none";
  tbody.innerHTML = visible.map(renderRow).join("");
  document.getElementById("active-count").textContent =
    `${visible.length} active runs across ${activeRepos.size} of ${totalRepos} ${state.org} repos`;
}

function comparator({ key, dir }) {
  const mul = dir === "asc" ? 1 : -1;
  return (a, b) => {
    let av, bv;
    switch (key) {
      case "repo": av = a.repo; bv = b.repo; break;
      case "workflow": av = a.workflow; bv = b.workflow; break;
      case "ref": av = a.ref; bv = b.ref; break;
      case "event": av = a.event; bv = b.event; break;
      case "status": av = a.status; bv = b.status; break;
      case "actor": av = a.actor ? a.actor.login : ""; bv = b.actor ? b.actor.login : ""; break;
      case "started":
      case "elapsed":
      default:
        av = new Date(a.started_at).getTime();
        bv = new Date(b.started_at).getTime();
        // elapsed-desc == started-asc semantically; flip when key is elapsed
        if (key === "elapsed") return (av - bv) * -mul;
        return (av - bv) * mul;
    }
    return av.localeCompare(bv) * mul;
  };
}

function renderRow(r) {
  const elapsed = r.status === "in_progress" ? formatElapsed(r.started_at) : "—";
  const actorCell = r.actor
    ? `<a href="${r.actor.html_url}" target="_blank" rel="noopener"><img class="actor-avatar" src="${r.actor.avatar_url}" alt="" width="16" height="16"> ${escapeHtml(r.actor.login)}</a>`
    : "";
  return `
    <tr>
      <td><a href="${r.repo_url}" target="_blank" rel="noopener">${escapeHtml(r.repo)}</a></td>
      <td><a href="${r.workflow_url}" target="_blank" rel="noopener">${escapeHtml(r.workflow || "")}</a></td>
      <td><a href="${r.run_url}" target="_blank" rel="noopener">#${r.run_number}</a></td>
      <td><a href="${r.ref_url}" target="_blank" rel="noopener">${escapeHtml(r.ref || "")}</a></td>
      <td>${escapeHtml(r.event)}</td>
      <td>${actorCell}</td>
      <td><span class="status status-${r.status}">${r.status === "in_progress" ? "running" : "queued"}</span></td>
      <td>${formatRelative(r.started_at)}</td>
      <td class="elapsed" data-started="${r.started_at}" data-status="${r.status}">${elapsed}</td>
    </tr>
  `;
}

function formatRelative(iso) {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function formatElapsed(iso) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mm = Math.floor(diff / 60_000);
  const ss = Math.floor((diff % 60_000) / 1000);
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function tickElapsed() {
  for (const cell of document.querySelectorAll(".elapsed")) {
    if (cell.dataset.status !== "in_progress") continue;
    cell.textContent = formatElapsed(cell.dataset.started);
  }
  renderRateLimit();
}

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

function showError(msg) {
  document.getElementById("status").textContent = "";
  const main = document.querySelector("main");
  main.innerHTML = `<div class="error">${escapeHtml(msg)} <a href="./index.html">← All orgs</a></div>`;
}

function setAutoRefresh(value) {
  if (state.autoRefreshTimer) {
    clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
  const ms = REFRESH_INTERVALS[value] || 0;
  if (ms > 0) state.autoRefreshTimer = setInterval(() => poll(), ms);
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

main().catch((err) => showError(err.message));
