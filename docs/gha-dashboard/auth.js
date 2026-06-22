// Personal Access Token auth for the Ribose GitHub Actions Dashboard.
// Browser-side OAuth Device Flow was abandoned because GitHub's
// /login/device/code does not support cross-origin CORS from arbitrary
// browser origins (verified empirically; see issue #29). api.github.com
// itself supports CORS, so once the user pastes a PAT the rest works.

const TOKEN_KEY = "metanorma-actions-dashboard.token";
const USER_KEY = "metanorma-actions-dashboard.user";
const SCOPES_KEY = "metanorma-actions-dashboard.scopes";
export const TOKEN_NEW_URL =
  "https://github.com/settings/tokens/new?description=Ribose%20GitHub%20Actions%20Dashboard&scopes=repo,read:org";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getCachedScopes() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SCOPES_KEY) || "[]"));
  } catch (_) {
    return new Set();
  }
}

export function recordScopesFromResponse(res) {
  if (!res || !res.headers) return;
  const raw = res.headers.get("X-OAuth-Scopes");
  if (raw === null) return;
  const scopes = raw.split(",").map((s) => s.trim()).filter(Boolean);
  localStorage.setItem(SCOPES_KEY, JSON.stringify(scopes));
}

export function getCachedUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function ensureAuthenticated() {
  const existing = getToken();
  if (existing) {
    // Re-verify the cached token before trusting it. Previously this
    // function returned the cached value unchecked, so a token that had
    // since expired or been revoked would silently flow through to the
    // first GitHub API call and surface as a downstream 401 (e.g.
    // "Failed to enumerate repos in metanorma: 401") rather than as a
    // clear "your token expired, sign in again" prompt.
    try {
      const user = await fetchUser(existing);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      return existing;
    } catch (_) {
      // Token rejected (expired / revoked / scope changed). Drop the
      // stale credentials and fall through to the PAT prompt below.
      signOut();
    }
  }
  return runPatPrompt();
}

function runPatPrompt() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "pat-modal";
    overlay.innerHTML = `
      <div class="pat-card">
        <h2>Sign in with a GitHub token</h2>
        <p>Paste a <strong>personal access token</strong> with the <code>repo</code> and <code>read:org</code> scopes. <code>repo</code> lets the dashboard list workflow runs in repos you have access to (public and private); <code>read:org</code> lets it discover your personal-org memberships so you can add them via the "Manage subscriptions" panel.</p>
        <p><a href="${TOKEN_NEW_URL}" target="_blank" rel="noopener">Create a token on GitHub &rarr;</a> (the link pre-selects both scopes).</p>
        <input type="password" class="pat-input" placeholder="ghp_&hellip; or github_pat_&hellip;" autocomplete="off" spellcheck="false">
        <button type="button" class="pat-submit">Sign in</button>
        <p class="pat-error" hidden></p>
        <p class="pat-hint">Stored in this browser's <code>localStorage</code>; only sent to <code>api.github.com</code>.</p>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector(".pat-input");
    const submit = overlay.querySelector(".pat-submit");
    const error = overlay.querySelector(".pat-error");
    input.focus();

    const trySubmit = async () => {
      const token = input.value.trim();
      if (!token) return;
      submit.disabled = true;
      submit.textContent = "Verifying…";
      error.hidden = true;
      try {
        const user = await fetchUser(token);
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        overlay.remove();
        resolve(token);
      } catch (e) {
        submit.disabled = false;
        submit.textContent = "Sign in";
        error.textContent = e.message;
        error.hidden = false;
        input.focus();
        input.select();
      }
    };
    submit.addEventListener("click", trySubmit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") trySubmit();
    });
  });
}

// Build an Error with GitHub's actual `message` body field (and any SAML SSO
// hint header) instead of just the bare HTTP status, so callers surface
// "Bad credentials" / "Resource protected by organization SAML enforcement"
// rather than a context-free `401`. Exported because dashboard.js uses it
// at its own API call sites too.
export async function githubError(res, prefix = "") {
  let message = res.statusText || `HTTP ${res.status}`;
  try {
    const body = await res.json();
    if (body && body.message) message = body.message;
  } catch (_) {
    /* non-JSON body; fall back to statusText */
  }
  const sso = res.headers.get("X-GitHub-SSO");
  if (sso) message += ` [X-GitHub-SSO: ${sso}]`;
  const label = prefix ? `${prefix}: ` : "";
  return new Error(`${label}${res.status} ${message}`);
}

async function fetchUser(token) {
  let res;
  try {
    res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
  } catch (_) {
    throw new Error("Network error reaching api.github.com.");
  }
  if (res.status === 401) throw new Error("Token rejected by GitHub (401). Double-check it.");
  if (!res.ok) throw await githubError(res, "GET /user failed");
  recordScopesFromResponse(res);
  const body = await res.json();
  return { login: body.login, avatar_url: body.avatar_url };
}

export function renderAuthHeader(container, { onSignOut } = {}) {
  const user = getCachedUser();
  if (!user) {
    container.innerHTML = `<span class="auth-pending">Signing in&hellip;</span>`;
    return;
  }
  container.innerHTML = `
    <img class="auth-avatar" src="${user.avatar_url}" alt="" width="20" height="20">
    <span class="auth-login">@${user.login}</span>
    <button type="button" class="auth-signout">Sign out</button>
  `;
  container.querySelector(".auth-signout").addEventListener("click", () => {
    signOut();
    if (onSignOut) onSignOut();
    else location.reload();
  });
}
