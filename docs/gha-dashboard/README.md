# Ribose GitHub Actions Dashboard

A live web dashboard showing every GitHub Actions workflow run that is currently **queued** or **in progress** across the 23 orgs we collaborate on — **metanorma**, **relaton**, **lutaml**, **plurimath**, **claricle**, plus the Ribose project orgs (actions-mn, capsiums, confium, fontist, geolexica, glossarist, interscript, ituob, kotoshu, omnizip, paneron, parsanol, pubid, riboseinc, rnpgp, tamatebako, ukiryu, unitsml).

Useful for spotting stuck jobs, coordinating release runs, and getting a quick "is CI healthy across the stack?" snapshot.

> **⚠️ Use the in-page "Refresh now" button, not your browser's reload.** A browser hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) — and a plain reload after the cache has expired — forces the dashboard to re-scan every repo in the org from scratch, on the order of ~120 GitHub API calls in one burst on metanorma (down from ~850 before the activity shortlist landed). Your hourly budget is 5000, so a handful of hard-refreshes in quick succession can still run you out. The in-page **Refresh now** reuses the browser cache and is essentially free — a small handful of calls for runs that have actually changed state since the last poll. See *[Rate-limit, refresh cadence, and the ETag cache](#rate-limit-refresh-cadence-and-the-etag-cache)* below for the full mechanism.

## Where to find it

- **Public URL** (after a metanorma org owner enables GitHub Pages on this repo): `https://metanorma.github.io/metanorma-release/gha-dashboard/`
- **Local**, from a clone of this repo: see [Running locally](#running-locally) below.

The Pages URL is the one to share with colleagues — no clone needed.

## First-time setup (~2 minutes)

You'll do this once per browser. The token lives in your browser's local storage; it is never sent anywhere except `api.github.com`.

### 1. Open the dashboard

Click the **Public URL** above (or open it locally — both work the same way). You'll see a sign-in panel asking for a personal access token.

### 2. Create a token on GitHub

Click the **"Create a token on GitHub →"** link in the sign-in panel. It opens `https://github.com/settings/tokens/new` with the right scope and description pre-filled. You only need to:

- Set an **expiration** (90 days is fine; "No expiration" if you don't mind regenerating less often).
- Scroll down and click **Generate token**.
- Copy the token that appears (starts with `ghp_…`). It is shown **only once** — if you lose it you'll just generate another.

The scope is **`repo`**, which lets the dashboard see workflow runs in both public repos and the private repos you personally have access to. The token cannot do anything the dashboard does not ask GitHub for: it reads workflow run lists, nothing more, and it lives on your machine only.

### 3. Paste and sign in

Paste the token into the field in the dashboard's sign-in panel and click **Sign in**. After a short verification step you should see the curated grid of org tiles. Click any of them to see its active runs.

That's it. From now on, opening the dashboard in this browser will skip the sign-in panel and go straight to the org tiles.

## Using the dashboard

- **Entry page** lists the orgs you're subscribed to. Click one to drill in. Use the **"Manage subscriptions"** panel at the bottom of the entry page to hide orgs you don't care about; new orgs added to `orgs.json` later will appear automatically (subscribed by default). The choice is per-browser, stored in your local storage; it doesn't affect anyone else.
- **Per-org page** shows a table of every workflow run that is queued or in progress in *that one org*. Repos with nothing happening are hidden — you only see things in motion.

### The three refresh controls

The per-org page does its work in two distinct steps: first it asks GitHub for the **list of repos in the org** (the "repo list"), then for each repo it asks GitHub which workflow runs are currently **queued or in progress** (the "run list"). The repo list is cached for the rest of the browser session because orgs rarely add/remove repos mid-session, and re-fetching ~80 repos every poll would be wasteful. The three refresh controls hit different combinations of these two steps:

- **Refresh now** — re-fetches just the *run list* for every cached repo. Use this when you want a current-state snapshot, e.g. "did that job finish yet?" / "has the queue cleared?". This is the cheap-and-frequent refresh.
- **Auto (off / 15s / 30s / 60s)** — does exactly the same thing as "Refresh now" automatically on a timer. Off by default. ETag conditional caching means each repeat poll is near-free against the GitHub API rate limit when nothing has changed.
- **Rescan org** — re-fetches the *repo list* from GitHub *and clears the persisted ETag cache*, then refreshes the runs. Use this when a repo has been **added to, removed from, renamed in, archived in, or unarchived in** the org since you opened the dashboard. Normal "Refresh now" / "Auto" cycles will NOT pick up such changes because they reuse the cached repo list. Rarely needed in a single sitting — and **expensive**, since clearing the ETag cache forces a fresh `200` response for every repo on the next poll.
- **include cold repos** — by default the dashboard skips repos with no push in the last 30 days, since they almost never have queued or in-progress runs. Tick this if you specifically need to catch a `schedule:`-triggered run on an otherwise-idle repo. Doing so re-enables the full org scan and costs proportionally more API budget.

## Rate-limit, refresh cadence, and the ETag cache

The GitHub REST budget for an authenticated user is **5000 calls per hour** in a rolling window, displayed in the footer as `Rate-limit: N / 5000 — resets in Xm`. The dashboard is designed to stay well below that ceiling, *provided* the browser's HTTP cache and the dashboard's own ETag cache are warm. Two facts you need to know to keep it that way:

**1. Within ~60 seconds of any prior fetch, refreshes are completely free.** GitHub returns `Cache-Control: private, max-age=60` on the endpoints we hit. Your browser serves the prior response directly from disk with no network call at all — `X-RateLimit-Remaining` does not move because nothing was sent to GitHub. The flip side is that you also see no new data; hitting "Refresh now" rapid-fire to chase a state change is harmless but pointless.

**2. Past 60 seconds, unchanged repos still cost zero.** The browser sends `If-None-Match` automatically; GitHub returns `304 Not Modified`; and **304 responses do not consume the 5000-per-hour budget**. The only requests that cost anything are repos where a workflow run actually changed state since the last poll — typically a small handful even on a busy day.

### What is expensive

The dashboard has to enumerate repos and ask each one for its run list — there is no org-level "list all active workflow runs" endpoint in either the REST or GraphQL API. So a **cold-cache scan**, where the dashboard genuinely has to fetch fresh `200` responses for every repo in scope, is the only really expensive operation. It happens in four situations:

| When | Cost on metanorma | Mitigation |
|---|---|---|
| First visit ever in this browser profile | ~120 calls (activity shortlist) | Falls back to ~60–120 because the 30-day shortlist excludes long-idle repos |
| Hard refresh (Ctrl+Shift+R / Cmd+Shift+R) | ~120 calls | Use the in-page **Refresh now** button instead — it reuses the browser cache and the ETag map |
| Clicking **Rescan org** | ~120 calls | Only click it when the repo list itself is stale (a repo was added/renamed/archived). Don't use it to "force a refresh of the runs" — that's what **Refresh now** is for, and it's far cheaper |
| Browser cache eviction or "Disable cache while DevTools is open" | up to ~120 calls | Don't toggle that DevTools option while using the dashboard — it defeats both the HTTP cache and 304 revalidation |
| Ticking **include cold repos** | Up to ~850 calls (the full org) | Only tick this when you specifically need to catch a scheduled run on a long-idle repo. Untick it once you're done |

### Keeping the ETag cache warm

The dashboard persists its ETag map in `localStorage` (per-org), so the cache survives navigating away from the dashboard, switching between org pages, and restarting the browser. You don't need to do anything to enable this — it's automatic. The cache is cleared in only two situations:

- You click **Rescan org** (intentional reset for a stale repo list).
- You clear site data for `metanorma.github.io` (or your local origin if you're running locally). The PAT in `localStorage` is wiped at the same time, so this also signs you out.

Aggressive private/incognito sessions start with an empty cache each time, so each new private session pays the cold-load cost once. Fine for occasional use; avoid as a habit.

### Auto-refresh: is it safe?

Yes, in steady state. ETag revalidation costs zero for unchanged repos, so a 30-second auto-refresh against a quiet org barely moves the rate-limit indicator. A 15-second auto-refresh against a busy org during a heavy CI burst is the worst case — every run-state change costs one `200` — but even then the bound is "a handful of calls per poll", not "hundreds". If the indicator is dropping faster than you expect, that's diagnostic data: it means CI is actually changing state, not that the dashboard is leaking calls.

### Other controls

- **Sort columns** by clicking column headers; default is "longest-running first" so stuck jobs are at the top.
- **Filter** by repo name, workflow name, and status (in-progress / queued).
- **"← All orgs"** in the header returns to the entry page.
- **Sign out** clears the token from this browser; next visit will ask for a new one.

## FAQ

**Why a PAT and not a one-click GitHub sign-in?** GitHub's OAuth Device Flow endpoints don't accept browser-side cross-origin requests, so the live in-browser fetch architecture has no clean way to use them. PAT-paste was the smallest viable workaround that keeps the dashboard live and self-serve.

**Will the dashboard see my private repos?** Yes — but only the private repos *you yourself* can already see on GitHub.com. The token is per-user; it cannot reach anything you don't have access to.

**Is the token safe to paste?** It is stored only in your browser's `localStorage`, scoped to the dashboard's URL. It is sent only to `api.github.com` (over HTTPS) when the dashboard queries workflow runs. It is never logged, never sent to any third party, never committed to the repo. You can revoke it any time at `https://github.com/settings/tokens`.

**I get "Token rejected by GitHub (401)".** The token is invalid, expired, revoked, or was pasted with extra whitespace. Generate a fresh one and retry.

**The dashboard is empty / shows "All quiet".** That means there are genuinely no queued or in-progress runs in that org right now. Try triggering a workflow manually (e.g. `gh workflow run` on any repo) and refresh — it should appear.

**Rate-limit warning in the footer.** The authenticated GitHub API budget is 5000 calls per hour per user. A cold-cache scan of metanorma (the largest org) is roughly **120 calls** with the activity shortlist enabled — down from ~850 before — and steady-state polling is essentially free thanks to ETag conditional caching (304s do not consume budget). The two ways to burn through the budget anyway are (a) repeated hard refreshes of the dashboard, which bust the browser's HTTP cache and force fresh `200` responses, and (b) leaving **include cold repos** ticked, which restores the full ~850-call scan. See *[Rate-limit, refresh cadence, and the ETag cache](#rate-limit-refresh-cadence-and-the-etag-cache)*.

## Running locally

Useful if the Pages URL isn't published yet (because the metanorma-release Pages source hasn't been enabled, or because you want to test the branch before merge), or if you just want to keep a personal copy that doesn't depend on Ribose infrastructure.

### Prerequisites

- **Git**, any version.
- **Python 3**, any version that includes the `http.server` module — preinstalled on macOS and on essentially every Linux distribution. Verify with `python3 --version`.
- A clone of `metanorma/metanorma-release`. If you don't have one yet:

  ```bash
  git clone https://github.com/metanorma/metanorma-release.git
  cd metanorma-release
  ```

### Launching the local web server

From the repo root, in a terminal:

```bash
python3 -m http.server 8000
```

That binds a static-file server to port 8000 serving the repo root; you'll see a line like `Serving HTTP on :: port 8000 (http://[::]:8000/) ...`. **Leave the terminal open** — the server runs only as long as that process is alive.

Then open `http://localhost:8000/docs/gha-dashboard/` in your browser. From here, sign-in and usage are identical to the Pages URL.

> **Don't just double-click `index.html` to open it as a `file://` URL.** Browsers block `fetch()` of local files from `file://` origins for security, so `orgs.json` won't load and the dashboard stays blank with no error. Always go through `http://localhost:8000`.

If port 8000 is already in use on your machine (e.g. another dev server), pick anything else:

```bash
python3 -m http.server 8765
```

and visit `http://localhost:8765/docs/gha-dashboard/` instead. The port number is just a label; nothing about the dashboard depends on a specific one.

### Stopping the server

In the terminal where it's running, press **`Ctrl-C`**. That sends an interrupt signal, the Python process exits, and the port is freed. You should see the prompt return.

If you backgrounded it (e.g. ran `python3 -m http.server 8000 &` or with `nohup`), find and kill it by port instead:

```bash
lsof -ti :8000 | xargs kill
```

Replace `8000` with whatever port you used. `lsof -ti :PORT` prints the PID of whatever owns that port; piping into `kill` terminates it.

### Note on tokens across origins

The PAT in your browser's `localStorage` is scoped per origin. The Pages site (`https://metanorma.github.io`) and your local copy (`http://localhost:8000`) are *different* origins, so a token pasted on one is invisible to the other. You'll be prompted for the token again on first visit to each origin — the same token works in both, just paste it again. Signing out from one origin does not sign you out from the other.

## Adding a new org

If your team works in an org that isn't in the dropdown, open a PR against `docs/gha-dashboard/orgs.json` adding it to the list. The shape is:

```json
{ "name": "your-org-slug", "label": "Display Name" }
```

Once merged, the new org tile appears on the entry page automatically.

## Reporting problems

File an issue on this repo (`metanorma/metanorma-release`) and tag whatever happened. The design ticket for the dashboard is [#29](https://github.com/metanorma/metanorma-release/issues/29); architecture context lives there.
