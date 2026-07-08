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

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const memberId = String(body?.member_id || "");
    if (!memberId) {
      return new Response(JSON.stringify({ error: "member_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Look up the member row
    const { data: target } = await admin.from("clinic_members")
      .select("clinic_id, user_id").eq("id", memberId).maybeSingle();
    if (!target) {
      return new Response(JSON.stringify({ error: "Member not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Caller must be an admin of the clinic
    const { data: meRow } = await admin.from("clinic_members")
      .select("role").eq("clinic_id", target.clinic_id).eq("user_id", user.id).maybeSingle();
    if (!meRow || meRow.role !== "admin") {
      return new Response(JSON.stringify({ error: "Only clinic admins can resend invites" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get target email
    const { data: targetUser, error: getErr } = await admin.auth.admin.getUserById(target.user_id);
    if (getErr || !targetUser?.user?.email) {
      return new Response(JSON.stringify({ error: "Could not find user email" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const email = targetUser.user.email;
    const confirmed = !!targetUser.user.email_confirmed_at;
    const redirectTo = `${req.headers.get("origin") || ""}/auth`;

    let mode: "invite" | "recovery" = "invite";
    let sentErr: string | null = null;

    if (!confirmed) {
      const { error: invErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (invErr) sentErr = invErr.message;
    } else {
      // Already confirmed -> send a password reset link via generateLink
      mode = "recovery";
      const { error: linkErr } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });
      if (linkErr) sentErr = linkErr.message;
    }

    if (sentErr) {
      return new Response(JSON.stringify({ error: sentErr }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, mode, email }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
