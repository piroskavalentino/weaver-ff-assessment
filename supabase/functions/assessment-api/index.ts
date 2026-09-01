// Weaver Upstream Field-to-Finance Maturity Assessment — Nashville / Enertia 2026
//
// Deno Edge Function. verify_jwt = false (see supabase/config.toml) because
// this project deliberately uses no Supabase Auth — every route does its own
// authorization below, against the write token (respondent routes) or the
// Reports passphrase (admin routes), never against a Supabase session.
//
// Deploy with: supabase functions deploy assessment-api --no-verify-jwt
//
// The browser sends the publishable key in the `apikey` header, never as
// `Authorization: Bearer` — the new publishable/secret keys are not JWTs and
// the platform gateway rejects them there before this handler ever runs.
//
// Database access uses the Supabase secret key (SUPABASE_SECRET_KEYS), never
// the legacy service_role key. This client bypasses RLS by design — RLS on
// `assessments` exists to lock the publishable key out, not to constrain
// this function.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEY =
  Deno.env.get("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;
const REPORTS_PASSPHRASE = Deno.env.get("REPORTS_PASSPHRASE") ?? "";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const db: SupabaseClient = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false },
});

const OWNERS = ["Sparsh", "Joseph"] as const;
type Owner = (typeof OWNERS)[number];

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(
  body: unknown,
  init: { status?: number; origin?: string | null; noStore?: boolean } = {},
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...corsHeaders(init.origin ?? null),
  };
  if (init.noStore) headers["Cache-Control"] = "no-store";
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

function ok(data: unknown, origin: string | null, noStore = false): Response {
  return json({ ok: true, data }, { status: 200, origin, noStore });
}

function fail(
  code: string,
  message: string,
  status: number,
  origin: string | null,
  noStore = false,
): Response {
  return json({ ok: false, code, message }, { status, origin, noStore });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// Reject any body carrying a key we don't expect for that route — the brief
// asks explicitly for unknown-property rejection, not silent stripping.
function assertKeys(body: Record<string, unknown>, allowed: string[], origin: string | null) {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) {
    throw new RouteError("bad_request", `Unknown field(s): ${extra.join(", ")}`, 400);
  }
}

class RouteError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function requireString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (!isNonEmptyString(v)) throw new RouteError("bad_request", `Missing or invalid "${key}"`, 400);
  return v;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Constant-time-ish string compare for the Reports passphrase, so this
// route doesn't leak timing information about how much of the guess matched.
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function requirePassphrase(body: Record<string, unknown>) {
  const p = body.passphrase;
  if (!REPORTS_PASSPHRASE || !isNonEmptyString(p) || !timingSafeEqual(p, REPORTS_PASSPHRASE)) {
    throw new RouteError("unauthorized", "Incorrect passphrase.", 401);
  }
}

// Public projection of a row for /admin/list — no answers, no tokens, no
// full email (masked the way the booth's own table() masks it).
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

function listProjection(row: Record<string, any>) {
  const snap = row.result_snapshot ?? {};
  return {
    id: row.id,
    response_id: row.response_id,
    role: row.role,
    maturity: snap.maturity ?? null,
    gap_total: snap.gap_total ?? row.result_snapshot?.gap_total ?? null,
    primary_pattern_name: snap.primary_pattern?.name ?? null,
    largest_opportunity_label: snap.largest_opportunity?.short_label ?? null,
    contact_name: row.contact_name,
    contact_company: row.contact_company,
    contact_email: maskEmail(row.contact_email),
    completed_at: row.completed_at,
    follow_up_owner: row.follow_up_owner,
    teaser_sent_at: row.teaser_sent_at,
    teaser_sent_by: row.teaser_sent_by,
    report_sent_at: row.report_sent_at,
    report_sent_by: row.report_sent_by,
  };
}

function fullProjection(row: Record<string, any>) {
  return {
    id: row.id,
    response_id: row.response_id,
    result_snapshot: row.result_snapshot,
    contact: {
      name: row.contact_name,
      company: row.contact_company,
      email: row.contact_email,
    },
    follow_up_owner: row.follow_up_owner,
    teaser_sent_at: row.teaser_sent_at,
    teaser_sent_by: row.teaser_sent_by,
    report_sent_at: row.report_sent_at,
    report_sent_by: row.report_sent_by,
  };
}

// ---------------------------------------------------------------------------
// respondent routes
// ---------------------------------------------------------------------------

async function routeStart(body: Record<string, unknown>, origin: string | null) {
  assertKeys(body, [
    "event_id",
    "response_id",
    "write_token",
    "instance_id",
    "content_version",
    "app_version",
    "role",
  ], origin);
  const event_id = requireString(body, "event_id");
  const response_id = requireString(body, "response_id");
  const write_token = requireString(body, "write_token");
  const content_version = requireString(body, "content_version");
  const instance_id = typeof body.instance_id === "string" ? body.instance_id : null;
  const app_version = typeof body.app_version === "string" ? body.app_version : null;
  const role = typeof body.role === "string" ? body.role : null;

  const write_token_hash = await sha256Hex(write_token);

  const { data: existing, error: selErr } = await db
    .from("assessments")
    .select("id, write_token_hash, status")
    .eq("event_id", event_id)
    .eq("response_id", response_id)
    .maybeSingle();
  if (selErr) throw new RouteError("db_error", "Could not look up record.", 500);

  if (existing) {
    // Idempotent retry: only hand the record back if the caller can prove
    // they hold the write token that created it. Otherwise this route could
    // be used to probe whether a guessed response_id already exists.
    if (existing.write_token_hash !== write_token_hash) {
      throw new RouteError("unauthorized", "Write token does not match this response.", 401);
    }
    return ok({ id: existing.id, status: existing.status }, origin);
  }

  const { data: inserted, error: insErr } = await db
    .from("assessments")
    .insert({
      event_id,
      response_id,
      instance_id,
      content_version,
      app_version,
      role,
      status: "in_progress",
      write_token_hash,
    })
    .select("id, status")
    .single();
  if (insErr) {
    // A unique-violation here means a concurrent /start beat us to it —
    // treat it the same as the idempotent-retry path above.
    const { data: race } = await db
      .from("assessments")
      .select("id, write_token_hash, status")
      .eq("event_id", event_id)
      .eq("response_id", response_id)
      .maybeSingle();
    if (race && race.write_token_hash === write_token_hash) {
      return ok({ id: race.id, status: race.status }, origin);
    }
    throw new RouteError("db_error", "Could not create record.", 500);
  }
  return ok({ id: inserted.id, status: inserted.status }, origin);
}

async function loadForWrite(event_id: string, response_id: string, write_token: string) {
  const { data: row, error } = await db
    .from("assessments")
    .select("id, write_token_hash, status")
    .eq("event_id", event_id)
    .eq("response_id", response_id)
    .maybeSingle();
  if (error) throw new RouteError("db_error", "Could not look up record.", 500);
  if (!row) throw new RouteError("not_found", "No record for this response_id.", 404);
  const hash = await sha256Hex(write_token);
  if (row.write_token_hash !== hash) {
    throw new RouteError("unauthorized", "Write token does not match this response.", 401);
  }
  return row;
}

async function routeSave(body: Record<string, unknown>, origin: string | null) {
  assertKeys(body, [
    "event_id",
    "response_id",
    "write_token",
    "role",
    "profile",
    "answers",
    "current_index",
    "started",
  ], origin);
  const event_id = requireString(body, "event_id");
  const response_id = requireString(body, "response_id");
  const write_token = requireString(body, "write_token");
  const row = await loadForWrite(event_id, response_id, write_token);

  if (row.status === "completed") {
    throw new RouteError("conflict", "This record is already completed.", 409);
  }

  // In-progress fields only, whole-record upsert on response_id — no patch
  // merging. May not touch status, contact fields, raffle eligibility,
  // result snapshot, completed_at, owner, or sent timestamps.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("role" in body) patch.role = typeof body.role === "string" ? body.role : null;
  if ("profile" in body) patch.profile = body.profile ?? {};
  if ("answers" in body) patch.answers = body.answers ?? {};

  const { error } = await db.from("assessments").update(patch).eq("id", row.id);
  if (error) throw new RouteError("db_error", "Could not save.", 500);
  return ok({ id: row.id, status: row.status }, origin);
}

async function routeComplete(body: Record<string, unknown>, origin: string | null) {
  assertKeys(body, ["event_id", "response_id", "write_token", "contact", "result_snapshot"], origin);
  const event_id = requireString(body, "event_id");
  const response_id = requireString(body, "response_id");
  const write_token = requireString(body, "write_token");
  const row = await loadForWrite(event_id, response_id, write_token);

  if (row.status === "completed") {
    // Idempotent: a second call (e.g. a retried offline completion) returns
    // the existing record rather than erroring or double-writing.
    const { data: full } = await db
      .from("assessments")
      .select("id, status, completed_at")
      .eq("id", row.id)
      .single();
    return ok(full, origin);
  }

  const contact = body.contact as Record<string, unknown> | undefined;
  if (!contact || typeof contact !== "object") {
    throw new RouteError("bad_request", "Missing contact.", 400);
  }
  const name = requireString(contact, "name");
  const company = requireString(contact, "company");
  const email = requireString(contact, "email");
  if (!EMAIL_RE.test(email)) throw new RouteError("bad_request", "Invalid email.", 400);

  const snapshot = body.result_snapshot;
  if (!snapshot || typeof snapshot !== "object") {
    throw new RouteError("bad_request", "Missing result_snapshot.", 400);
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await db
    .from("assessments")
    .update({
      status: "completed",
      contact_name: name,
      contact_company: company,
      contact_email: email,
      raffle_eligible: true,
      result_snapshot: snapshot,
      completed_at: now,
      updated_at: now,
    })
    .eq("id", row.id)
    .select("id, status, completed_at")
    .single();
  if (error) throw new RouteError("db_error", "Could not complete.", 500);
  return ok(updated, origin);
}

// ---------------------------------------------------------------------------
// admin routes (Reports passphrase)
// ---------------------------------------------------------------------------

async function routeAdminList(body: Record<string, unknown>, origin: string | null) {
  assertKeys(body, ["event_id", "passphrase"], origin);
  requirePassphrase(body);
  const event_id = requireString(body, "event_id");
  const { data, error } = await db
    .from("assessments")
    .select(
      "id, response_id, role, contact_name, contact_company, contact_email, completed_at, " +
        "follow_up_owner, teaser_sent_at, teaser_sent_by, report_sent_at, report_sent_by, result_snapshot",
    )
    .eq("event_id", event_id)
    .eq("status", "completed")
    .order("completed_at", { ascending: false });
  if (error) throw new RouteError("db_error", "Could not list records.", 500);
  return ok((data ?? []).map(listProjection), origin, true);
}

async function routeAdminGet(body: Record<string, unknown>, origin: string | null) {
  assertKeys(body, ["event_id", "passphrase", "id"], origin);
  requirePassphrase(body);
  const event_id = requireString(body, "event_id");
  const id = requireString(body, "id");
  const { data, error } = await db
    .from("assessments")
    .select(
      "id, response_id, result_snapshot, contact_name, contact_company, contact_email, " +
        "follow_up_owner, teaser_sent_at, teaser_sent_by, report_sent_at, report_sent_by",
    )
    .eq("event_id", event_id)
    .eq("id", id)
    .eq("status", "completed")
    .maybeSingle();
  if (error) throw new RouteError("db_error", "Could not load record.", 500);
  if (!data) throw new RouteError("not_found", "No such record.", 404);
  return ok(fullProjection(data), origin, true);
}

async function routeAdminMarkSent(body: Record<string, unknown>, origin: string | null) {
  assertKeys(body, ["event_id", "passphrase", "id", "kind", "sent_by"], origin);
  requirePassphrase(body);
  const event_id = requireString(body, "event_id");
  const id = requireString(body, "id");
  const kind = requireString(body, "kind");
  if (kind !== "teaser" && kind !== "report") {
    throw new RouteError("bad_request", 'kind must be "teaser" or "report".', 400);
  }
  const sentBy = body.sent_by;
  if (sentBy != null && !OWNERS.includes(sentBy as Owner)) {
    throw new RouteError("bad_request", "sent_by must be Sparsh or Joseph.", 400);
  }
  const now = new Date().toISOString();
  const patch =
    kind === "teaser"
      ? { teaser_sent_at: now, teaser_sent_by: sentBy ?? null, updated_at: now }
      : { report_sent_at: now, report_sent_by: sentBy ?? null, updated_at: now };
  const { error } = await db.from("assessments").update(patch).eq("event_id", event_id).eq("id", id);
  if (error) throw new RouteError("db_error", "Could not update record.", 500);
  return ok({ id }, origin, true);
}

async function routeAdminSetOwner(body: Record<string, unknown>, origin: string | null) {
  assertKeys(body, ["event_id", "passphrase", "id", "follow_up_owner"], origin);
  requirePassphrase(body);
  const event_id = requireString(body, "event_id");
  const id = requireString(body, "id");
  const owner = body.follow_up_owner;
  if (owner != null && !OWNERS.includes(owner as Owner)) {
    throw new RouteError("bad_request", "follow_up_owner must be Sparsh or Joseph.", 400);
  }
  const { error } = await db
    .from("assessments")
    .update({ follow_up_owner: owner ?? null, updated_at: new Date().toISOString() })
    .eq("event_id", event_id)
    .eq("id", id);
  if (error) throw new RouteError("db_error", "Could not update record.", 500);
  return ok({ id }, origin, true);
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------

const ROUTES: Record<string, (body: Record<string, unknown>, origin: string | null) => Promise<Response>> = {
  "/start": routeStart,
  "/save": routeSave,
  "/complete": routeComplete,
  "/admin/list": routeAdminList,
  "/admin/get": routeAdminGet,
  "/admin/mark-sent": routeAdminMarkSent,
  "/admin/set-owner": routeAdminSetOwner,
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return fail("method_not_allowed", "Use POST.", 405, origin);
  }

  const url = new URL(req.url);
  // Strip the function's own mount path so both a direct function URL and
  // one proxied under /functions/v1/assessment-api resolve the same route.
  const route = url.pathname.replace(/^\/(functions\/v1\/)?assessment-api/, "") || "/";
  // /admin/get returns real prospect contact details, so every response on
  // an admin route — including these early rejections, before we even know
  // which admin route it is — must carry Cache-Control: no-store.
  const noStore = route.startsWith("/admin/");
  const handler = ROUTES[route];
  if (!handler) return fail("not_found", "Unknown route.", 404, origin, noStore);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("bad_request", "Body must be JSON.", 400, origin, noStore);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("bad_request", "Body must be a JSON object.", 400, origin, noStore);
  }

  try {
    return await handler(body as Record<string, unknown>, origin);
  } catch (e) {
    if (e instanceof RouteError) {
      return fail(e.code, e.message, e.status, origin, noStore);
    }
    // Never return stack traces to the browser.
    console.error("assessment-api unhandled error:", e);
    return fail("internal_error", "Something went wrong.", 500, origin, noStore);
  }
});
