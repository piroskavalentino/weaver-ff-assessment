# Weaver Upstream Field-to-Finance Maturity Assessment

Booth assessment for the Enertia Software User Conference, September 3–4,
2026, in Nashville. The frozen, unmodified production file — content
version `1.4.2`, app version `2.3.1` — lives on `main` as
`weaver-upstream-diagnostic-v17.html` and is never touched; that commit is
the rollback point. All Nashville/Supabase-capture work lives on
`feature/nashville-supabase-capture`.

## Files (on `feature/nashville-supabase-capture`)

- `weaver-upstream-diagnostic-nashville.html` — the deployable file. A copy
  of v17 with the Supabase capture layer added: response identity, a local
  sync store, background sync to `assessment-api`, the visual teaser, the
  one-page report, and the Reports admin view. Everything from v17 —
  questions, scoring, routing, the local `wvr_ff_responses_v1` /
  `wvr_ff_draft` / `wvr_ff_instance` stores, the 45-minute draft window, the
  `ADMIN_PIN` Data screen, CSV/JSON export, Clear this device — is
  unchanged.
- `supabase/migrations/0001_create_assessments.sql` — the one table
  (`assessments`), RLS enabled with no anonymous policies.
- `supabase/functions/assessment-api/index.ts` — the one Edge Function.
  Respondent routes (`/start`, `/save`, `/complete`) authorize against a
  per-response write token; admin routes (`/admin/list`, `/admin/get`,
  `/admin/mark-sent`, `/admin/set-owner`) authorize against the Reports
  passphrase. `verify_jwt = false` — see `supabase/config.toml` — because
  this project uses no Supabase Auth; all authorization is in-code.
- `supabase/.env.example` — names the two Edge Function secrets
  (`REPORTS_PASSPHRASE`, `ALLOWED_ORIGINS`) for local `supabase functions
  serve`. Copy to `supabase/.env` (git-ignored) and fill in real values;
  never commit the filled-in file.

## Configuration

The only two values the frontend needs — `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY` — live in one `CONFIG` block near the top of the
`<script>` in `weaver-upstream-diagnostic-nashville.html`. Moving this build
to a different Supabase project later is: update those two values, run the
same migration against the new project, deploy the same function. Nothing
else changes.

Everything else is a Supabase secret, never in this repo:

- `REPORTS_PASSPHRASE` — the Reports view's own strong passphrase. Separate
  from `ADMIN_PIN` (which stays hardcoded in the HTML for the existing
  device-local Data screen) and not a numeric PIN.
- `ALLOWED_ORIGINS` — comma-separated exact origins allowed to call the
  function. Never defaults to `*`.
- The database credential the function itself uses comes from
  `SUPABASE_SECRET_KEYS` (the new secret-key model), provided by the
  Supabase platform/CLI automatically — not something you set by hand as a
  function secret.

## Hosting — read this before the booth

**Serve this file over `http://` or `https://` — never open it as a local
`file://` document.** `file://` origins are blocked from cross-origin
`fetch()` by every modern browser, so the sync layer will fail silently on
every device: the assessment itself still works (local-first, by design),
but nothing will ever reach Supabase, and there will be no visible error
telling you why.

**Keep an unmodified copy of `weaver-upstream-diagnostic-v17.html` on every
booth device as the disconnected fallback.** If a device's browser, wifi
driver, or the Supabase project itself has a bad day, v17 still runs the
full assessment with local storage and CSV export — no sync layer, no
teaser, no report, just the assessment.

## What is NOT deployed

Nothing in this repository has been deployed. `supabase/migrations` has
been tested against a local Postgres instance (see the session report in
the pull request / commit history) but never run against this repo's
hosted Supabase project. The GitHub Actions workflows below are
`workflow_dispatch`-only — they do not run on push — and have only been
syntax-validated, never executed.

- `.github/workflows/weaver-pages.yml` — stages only
  `weaver-upstream-diagnostic-nashville.html` (as `index.html`) to GitHub
  Pages. Run it by hand from the Actions tab when you're ready to publish.
- `.github/workflows/weaver-supabase.yml` — runs `supabase db push` and/or
  `supabase functions deploy assessment-api --no-verify-jwt`. Requires the
  `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`,
  `WEAVER_REPORTS_PASSPHRASE`, and `WEAVER_ALLOWED_ORIGINS` repository
  secrets to be set first, and requires typing `deploy` into the
  confirmation input.
