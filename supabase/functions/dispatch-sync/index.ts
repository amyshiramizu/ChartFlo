// Authenticated endpoint the Chrome extension calls to fetch and update a
// dispatch batch by share_code. Requires a valid Supabase JWT and verifies
// the user owns the batch before returning PHI.
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;

    // Use an authenticated client so RLS policies apply.
    const authHeader = req.headers.get("Authorization")!;
    const supabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const url = new URL(req.url);
    const code = (url.searchParams.get("code") || "").trim().toUpperCase();
    if (!code || code.length < 4 || code.length > 16) {
      return json({ error: "Invalid code" }, 400);
    }

    // RLS restricts to batches owned by the authenticated user.
    const { data: batch, error: batchErr } = await supabase
      .from("dispatch_batches")
      .select("id, label, instructions, created_at, user_id, default_chart_type, session_date")
      .eq("share_code", code)
      .maybeSingle();
    if (batchErr || !batch) return json({ error: "Batch not found" }, 404);

    if (batch.user_id !== auth.userId) {
      return json({ error: "Forbidden" }, 403);
    }

    if (req.method === "GET") {
      const { data: jobs } = await supabase
        .from("dispatch_jobs")
        .select("id, position, patient_name, mrn, subjective, objective, assessment, plan, status, filled_at, chart_type, actual_minutes, patient_id")
        .eq("batch_id", batch.id)
        .order("position", { ascending: true });
      return json({ batch, jobs: jobs ?? [] });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const { jobId, status, minutes } = body || {};
      if (!jobId) return json({ error: "jobId required" }, 400);
      const update: Record<string, unknown> = {};
      if (status) {
        if (!["pending", "done", "skipped"].includes(status)) {
          return json({ error: "invalid status" }, 400);
        }
        update.status = status;
        update.filled_at = status === "done" ? new Date().toISOString() : null;
        if (status === "done") update.completed_at = new Date().toISOString();
      }
      if (typeof minutes === "number" && minutes >= 0) {
        update.actual_minutes = Math.round(minutes);
      }
      if (Object.keys(update).length === 0) {
        return json({ error: "nothing to update" }, 400);
      }
      const { error: updErr } = await supabase
        .from("dispatch_jobs")
        .update(update)
        .eq("id", jobId)
        .eq("batch_id", batch.id);
      if (updErr) return json({ error: updErr.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
