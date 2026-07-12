// Port of supabase/functions/clinic-member-statuses.
//
// The original paged through supabase.auth.admin.listUsers() for
// email_confirmed_at / last_sign_in_at / invited_at / created_at. Cognito has
// no direct equivalent, so the fields degrade as follows (sourced from the
// profiles + clinic_members tables and ctx.cognito.getUser):
//   email_confirmed_at → profiles.created_at when the Cognito account status
//     is CONFIRMED (Cognito keeps no confirmation timestamp, only the state);
//     null otherwise — the frontend only checks truthiness (pending vs active).
//   last_sign_in_at   → always null (Cognito AdminGetUser does not expose it).
//   invited_at        → clinic_members.invited_at (set when the member was
//     invited to the clinic — closest available approximation).
//   created_at        → profiles.created_at.
// Members with neither a profiles row nor a Cognito account are omitted from
// `statuses`, matching the original's behavior for members absent from
// auth.users.

export default async function handler(body, ctx, event) {
  try {
    const userId = event?.requestContext?.authorizer?.jwt?.claims?.["custom:legacy_id"];
    if (!userId) return ctx.json(401, { error: "Invalid session" });

    const clinicId = String(body?.clinic_id || "");
    if (!clinicId) return ctx.json(400, { error: "clinic_id required" });

    // Caller must be a member of the clinic
    const meRows = await ctx.sql(
      "select role from clinic_members where clinic_id = :clinicId::uuid and user_id = :userId::uuid limit 1",
      { clinicId, userId },
    );
    if (!meRows[0]) return ctx.json(403, { error: "Not a member of this clinic" });

    const members = await ctx.sql(
      "select user_id, invited_at from clinic_members where clinic_id = :clinicId::uuid",
      { clinicId },
    );

    const memberIds = (members || []).map((m) => m.user_id);
    const profiles = memberIds.length
      ? await ctx.sql(
          "select user_id, email, created_at from profiles where user_id = any(string_to_array(:ids, ',')::uuid[])",
          { ids: memberIds.join(",") },
        )
      : [];
    const profileById = new Map(profiles.map((p) => [p.user_id, p]));

    const statuses = {};
    await Promise.all((members || []).map(async (m) => {
      const profile = profileById.get(m.user_id);
      const cognitoUser = profile?.email ? await ctx.cognito.getUser(profile.email) : null;
      if (!profile && !cognitoUser) return; // no account info at all — omit
      const confirmed = cognitoUser?.status === "CONFIRMED";
      statuses[m.user_id] = {
        email_confirmed_at: confirmed ? (profile?.created_at ?? m.invited_at ?? null) : null,
        last_sign_in_at: null,
        invited_at: m.invited_at ?? null,
        created_at: profile?.created_at ?? null,
      };
    }));

    return ctx.json(200, { statuses });
  } catch (e) {
    return ctx.json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
}
