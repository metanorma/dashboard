# Ribose GitHub Actions Dashboard

A live web dashboard showing every GitHub Actions workflow run that is currently **queued** or **in progress** across the orgs we collaborate on: **metanorma**, **relaton**, **lutaml**, **plurimath**, and **claricle**.

Useful for spotting stuck jobs, coordinating release runs, and getting a quick "is CI healthy across the stack?" snapshot.

## Where to find it

- **Public URL** (after a metanorma org owner enables GitHub Pages on this repo): `https://metanorma.github.io/metanorma-release/gha-dashboard/`
- **Local** (any clone of this repo): open `docs/gha-dashboard/index.html` in your browser, or run `python3 -m http.server 8000` from the repo root and visit `http://localhost:8000/docs/gha-dashboard/`

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

Paste the token into the field in the dashboard's sign-in panel and click **Sign in**. After a short verification step you should see five org tiles. Click any of them to see its active runs.

That's it. From now on, opening the dashboard in this browser will skip the sign-in panel and go straight to the org tiles.

## Using the dashboard

- **Entry page** lists the five orgs. Click one to drill in.
- **Per-org page** shows a table of every workflow run that is queued or in progress. Repos with nothing happening are hidden — you only see things in motion.
- **Refresh now** re-polls the org immediately.
- **Auto** dropdown polls every 15, 30, or 60 seconds.
- **Sort columns** by clicking column headers; default is "longest-running first" so stuck jobs are at the top.
- **Filter** by repo name, workflow name, and status.
- **"← All orgs"** in the header returns to the entry page.
- **Sign out** clears the token from this browser; next visit will ask for a new one.

## FAQ

**Why a PAT and not a one-click GitHub sign-in?** GitHub's OAuth Device Flow endpoints don't accept browser-side cross-origin requests, so the live in-browser fetch architecture has no clean way to use them. PAT-paste was the smallest viable workaround that keeps the dashboard live and self-serve.

**Will the dashboard see my private repos?** Yes — but only the private repos *you yourself* can already see on GitHub.com. The token is per-user; it cannot reach anything you don't have access to.

**Is the token safe to paste?** It is stored only in your browser's `localStorage`, scoped to the dashboard's URL. It is sent only to `api.github.com` (over HTTPS) when the dashboard queries workflow runs. It is never logged, never sent to any third party, never committed to the repo. You can revoke it any time at `https://github.com/settings/tokens`.

**I get "Token rejected by GitHub (401)".** The token is invalid, expired, revoked, or was pasted with extra whitespace. Generate a fresh one and retry.

**The dashboard is empty / shows "All quiet".** That means there are genuinely no queued or in-progress runs in that org right now. Try triggering a workflow manually (e.g. `gh workflow run` on any repo) and refresh — it should appear.

**Rate-limit warning in the footer.** The authenticated GitHub API budget is 5000 calls per hour per user. A full scan across all five orgs is around 850 calls; you'd need to manually refresh ~5 times per hour to come close. ETag caching on auto-refresh keeps the cost near zero, so this rarely matters in practice.

## Adding a new org

If your team works in an org that isn't in the dropdown, open a PR against `docs/gha-dashboard/orgs.json` adding it to the list. The shape is:

```json
{ "name": "your-org-slug", "label": "Display Name" }
```

Once merged, the new org tile appears on the entry page automatically.

## Reporting problems

File an issue on this repo (`metanorma/metanorma-release`) and tag whatever happened. The design ticket for the dashboard is [#29](https://github.com/metanorma/metanorma-release/issues/29); architecture context lives there.
