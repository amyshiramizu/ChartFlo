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
    const clinicId = String(body?.clinic_id || "");
    if (!clinicId) {
      return new Response(JSON.stringify({ error: "clinic_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Caller must be a member of the clinic
    const { data: meRow } = await admin.from("clinic_members")
      .select("role").eq("clinic_id", clinicId).eq("user_id", user.id).maybeSingle();
    if (!meRow) {
      return new Response(JSON.stringify({ error: "Not a member of this clinic" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: members } = await admin.from("clinic_members")
      .select("user_id").eq("clinic_id", clinicId);
    const ids = new Set((members || []).map((m: any) => m.user_id));

    // Page through auth users (project is small)
    const statuses: Record<string, { email_confirmed_at: string | null; last_sign_in_at: string | null; invited_at: string | null; created_at: string | null }> = {};
    let page = 1;
    while (true) {
      const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      const users = list?.users || [];
      for (const u of users) {
        if (ids.has(u.id)) {
          statuses[u.id] = {
            email_confirmed_at: u.email_confirmed_at ?? null,
            last_sign_in_at: u.last_sign_in_at ?? null,
            invited_at: (u as any).invited_at ?? null,
            created_at: u.created_at ?? null,
          };
        }
      }
      if (users.length < 200) break;
      page++;
      if (page > 20) break;
    }

    return new Response(JSON.stringify({ statuses }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
