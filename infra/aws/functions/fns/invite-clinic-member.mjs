// Port of supabase/functions/invite-clinic-member.
//
// Supabase → AWS mapping:
//   profiles lookup by email        → ctx.sql (ilike, first row = maybeSingle)
//   auth.admin.listUsers email scan → ctx.cognito.getUser(email)
//   auth.admin.inviteUserByEmail /
//   auth.admin.createUser           → ctx.cognito.inviteUser(email) (sends the
//     Cognito invite email with a temp password and returns the new legacy id)
//   on_auth_user_created_profile DB trigger (auto-created the profiles row on
//     signup in Supabase)           → explicit profiles insert below, same
//     columns: (user_id, email, full_name '') on conflict do nothing
//   clinic_members reads/writes     → ctx.sql, mirroring the original rows.

export default async function handler(body, ctx, event) {
  try {
    const userId = event?.requestContext?.authorizer?.jwt?.claims?.["custom:legacy_id"];
    if (!userId) return ctx.json(401, { error: "Invalid session" });

    const email = String(body?.email || "").trim().toLowerCase();
    const clinicId = String(body?.clinic_id || "").trim();
    const role = body?.role === "admin" ? "admin" : "member";
    if (!email || !clinicId) {
      return ctx.json(400, { error: "email and clinic_id are required" });
    }

    // Caller must be admin of the clinic
    const meRows = await ctx.sql(
      "select role from clinic_members where clinic_id = :clinicId::uuid and user_id = :userId::uuid limit 1",
      { clinicId, userId },
    );
    const meRow = meRows[0];
    if (!meRow || meRow.role !== "admin") {
      return ctx.json(403, { error: "Only clinic admins can invite members" });
    }

    // Find existing profile by email
    const profileRows = await ctx.sql(
      "select user_id from profiles where email ilike :email limit 1",
      { email },
    );
    let targetUserId = profileRows[0]?.user_id;

    // Fallback: search the Cognito user pool (replaces auth.admin.listUsers)
    if (!targetUserId) {
      const found = await ctx.cognito.getUser(email);
      targetUserId = found?.legacyId;
    }

    let invited = false;
    if (!targetUserId) {
      // Create the login account and send an invitation email so they can set
      // a password (Cognito emails a temporary password).
      try {
        targetUserId = await ctx.cognito.inviteUser(email);
      } catch (e) {
        return ctx.json(500, {
          error: `Could not create account for ${email}: ${e?.message || "unknown error"}`,
        });
      }
      invited = true;
    }

    // Ensure the profiles row exists (Supabase created it via the
    // on_auth_user_created_profile trigger on auth.users insert).
    await ctx.sql(
      "insert into profiles (user_id, email, full_name) values (:userId::uuid, :email, '') on conflict (user_id) do nothing",
      { userId: targetUserId, email },
    );

    // Already a member?
    const existingRows = await ctx.sql(
      "select id, role from clinic_members where clinic_id = :clinicId::uuid and user_id = :userId::uuid limit 1",
      { clinicId, userId: targetUserId },
    );
    const existing = existingRows[0];
    if (existing) {
      // Idempotent: update role if changed, otherwise no-op
      if (existing.role !== role) {
        await ctx.sql("update clinic_members set role = :role where id = :id::uuid", { role, id: existing.id });
      }
      return ctx.json(200, { ok: true, user_id: targetUserId, invited, already_member: true });
    }

    await ctx.sql(
      "insert into clinic_members (clinic_id, user_id, role) values (:clinicId::uuid, :userId::uuid, :role)",
      { clinicId, userId: targetUserId, role },
    );

    return ctx.json(200, { ok: true, user_id: targetUserId, invited });
  } catch (e) {
    console.error("invite-clinic-member error:", e);
    return ctx.json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
}
