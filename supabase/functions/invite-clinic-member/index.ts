import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Authenticate caller
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const clinicId = String(body?.clinic_id || "").trim();
    const role = body?.role === "admin" ? "admin" : "member";
    if (!email || !clinicId) {
      return new Response(JSON.stringify({ error: "email and clinic_id are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Caller must be admin of the clinic
    const { data: meRow } = await admin.from("clinic_members")
      .select("role").eq("clinic_id", clinicId).eq("user_id", user.id).maybeSingle();
    if (!meRow || meRow.role !== "admin") {
      return new Response(JSON.stringify({ error: "Only clinic admins can invite members" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find existing profile by email
    const { data: profile } = await admin.from("profiles")
      .select("user_id").ilike("email", email).maybeSingle();

    let targetUserId = profile?.user_id as string | undefined;

    // Fallback: search auth.users via admin API
    if (!targetUserId) {
      // listUsers paginates; search by email filter (Supabase ignores filter but returns 1 if email match)
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const found = list?.users?.find((u) => (u.email || "").toLowerCase() === email);
      targetUserId = found?.id;
    }

    let invited = false;
    if (!targetUserId) {
      // Create the user and send an invitation email so they can set a password
      const redirectTo = `${req.headers.get("origin") || ""}/auth`;
      const { data: inv, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
      });
      if (invErr || !inv?.user?.id) {
        // Fallback: create user directly without email
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          email_confirm: false,
        });
        if (createErr || !created?.user?.id) {
          return new Response(JSON.stringify({
            error: `Could not create account for ${email}: ${invErr?.message || createErr?.message || "unknown error"}`,
          }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        targetUserId = created.user.id;
      } else {
        targetUserId = inv.user.id;
      }
      invited = true;
    }

    // Already a member?
    const { data: existing } = await admin.from("clinic_members")
      .select("id, role").eq("clinic_id", clinicId).eq("user_id", targetUserId).maybeSingle();
    if (existing) {
      // Idempotent: update role if changed, otherwise no-op
      if (existing.role !== role) {
        await admin.from("clinic_members").update({ role }).eq("id", existing.id);
      }
      return new Response(JSON.stringify({ ok: true, user_id: targetUserId, invited, already_member: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: insErr } = await admin.from("clinic_members")
      .insert({ clinic_id: clinicId, user_id: targetUserId, role });
    if (insErr) throw insErr;

    return new Response(JSON.stringify({ ok: true, user_id: targetUserId, invited }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("invite-clinic-member error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
