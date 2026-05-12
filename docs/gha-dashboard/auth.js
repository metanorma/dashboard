// OAuth Device Flow auth for the Ribose GitHub Actions Dashboard.
// Client ID is the public OAuth App identifier; safe to commit. The app is
// registered under @opoudjis with Device Flow enabled.
export const CLIENT_ID = "Ov23ctdTo73CKizaGSuv";

const TOKEN_KEY = "metanorma-actions-dashboard.token";
const USER_KEY = "metanorma-actions-dashboard.user";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const VERIFICATION_URI = "https://github.com/login/device";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
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
  let token = getToken();
  if (token) return token;
  token = await runDeviceFlow();
  localStorage.setItem(TOKEN_KEY, token);
  const user = await fetchUser(token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return token;
}

async function fetchUser(token) {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GET /user failed: ${res.status}`);
  const body = await res.json();
  return { login: body.login, avatar_url: body.avatar_url };
}

async function runDeviceFlow() {
  if (CLIENT_ID === "REPLACE_WITH_OAUTH_APP_CLIENT_ID") {
    throw new Error(
      "OAuth Client ID not configured. Edit docs/gha-dashboard/auth.js and set CLIENT_ID.",
    );
  }
  const start = await postForm(DEVICE_CODE_URL, { client_id: CLIENT_ID, scope: "" });
  const { device_code, user_code, verification_uri, interval, expires_in } = start;
  const deadline = Date.now() + expires_in * 1000;
  const dismissed = renderDeviceModal({ user_code, verification_uri: verification_uri || VERIFICATION_URI });
  let pollInterval = (interval || 5) * 1000;
  while (Date.now() < deadline) {
    if (dismissed.cancelled) throw new Error("Sign-in cancelled.");
    await sleep(pollInterval);
    const tokenRes = await postForm(ACCESS_TOKEN_URL, {
      client_id: CLIENT_ID,
      device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    if (tokenRes.access_token) {
      dismissModal();
      return tokenRes.access_token;
    }
    if (tokenRes.error === "authorization_pending") continue;
    if (tokenRes.error === "slow_down") {
      pollInterval += 5000;
      continue;
    }
    if (tokenRes.error === "expired_token" || tokenRes.error === "access_denied") {
      dismissModal();
      throw new Error(`Sign-in failed: ${tokenRes.error}`);
    }
    throw new Error(`Unexpected token response: ${JSON.stringify(tokenRes)}`);
  }
  dismissModal();
  throw new Error("Device code expired before sign-in completed.");
}

async function postForm(url, params) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function renderDeviceModal({ user_code, verification_uri }) {
  const state = { cancelled: false };
  const overlay = document.createElement("div");
  overlay.id = "device-flow-modal";
  overlay.innerHTML = `
    <div class="device-flow-card">
      <h2>Sign in to GitHub</h2>
      <p>Open <a href="${verification_uri}" target="_blank" rel="noopener">${verification_uri}</a> and enter the code:</p>
      <div class="device-flow-code">${user_code}</div>
      <button type="button" class="device-flow-open">Copy code &amp; open GitHub</button>
      <button type="button" class="device-flow-cancel">Cancel</button>
      <p class="device-flow-hint">This page will continue automatically once you complete consent.</p>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector(".device-flow-open").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(user_code);
    } catch (_) {}
    window.open(verification_uri, "_blank", "noopener");
  });
  overlay.querySelector(".device-flow-cancel").addEventListener("click", () => {
    state.cancelled = true;
    dismissModal();
  });
  return state;
}

function dismissModal() {
  const overlay = document.getElementById("device-flow-modal");
  if (overlay) overlay.remove();
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
