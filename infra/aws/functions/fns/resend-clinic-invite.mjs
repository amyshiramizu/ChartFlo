// Port of supabase/functions/resend-clinic-invite.
//
// Supabase → AWS mapping:
//   clinic_members lookups            → ctx.sql (limit 1 = maybeSingle)
//   auth.admin.getUserById (email)    → profiles table lookup by user_id;
//     confirmation state via ctx.cognito.getUser(email).status
//   auth.admin.inviteUserByEmail      → ctx.cognito.resendInvite(email)
//     (re-sends the Cognito invite with a fresh temporary password)
//   auth.admin.generateLink(recovery) → NOT portable: ctx.cognito exposes no
//     password-reset email. For already-confirmed users this returns the
//     original's 500 { error } shape with an explanatory message instead of
//     silently claiming an email was sent.

export default async function handler(body, ctx, event) {
  try {
    const userId = event?.requestContext?.authorizer?.jwt?.claims?.["custom:legacy_id"];
    if (!userId) return ctx.json(401, { error: "Invalid session" });

    const memberId = String(body?.member_id || "");
    if (!memberId) return ctx.json(400, { error: "member_id required" });

    // Look up the member row
    const targetRows = await ctx.sql(
      "select clinic_id, user_id from clinic_members where id = :memberId::uuid limit 1",
      { memberId },
    );
    const target = targetRows[0];
    if (!target) return ctx.json(404, { error: "Member not found" });

    // Caller must be an admin of the clinic
    const meRows = await ctx.sql(
      "select role from clinic_members where clinic_id = :clinicId::uuid and user_id = :userId::uuid limit 1",
      { clinicId: target.clinic_id, userId },
    );
    const meRow = meRows[0];
    if (!meRow || meRow.role !== "admin") {
      return ctx.json(403, { error: "Only clinic admins can resend invites" });
    }

    // Get target email (profiles mirrors auth user emails)
    const profileRows = await ctx.sql(
      "select email from profiles where user_id = :userId::uuid limit 1",
      { userId: target.user_id },
    );
    const email = profileRows[0]?.email;
    const cognitoUser = email ? await ctx.cognito.getUser(email) : null;
    if (!email || !cognitoUser) {
      return ctx.json(404, { error: "Could not find user email" });
    }
    // Cognito FORCE_CHANGE_PASSWORD = invited but never signed in;
    // CONFIRMED = the email_confirmed_at case in the original.
    const confirmed = cognitoUser.status === "CONFIRMED";

    let mode = "invite";
    let sentErr = null;

    if (!confirmed) {
      try {
        await ctx.cognito.resendInvite(email);
      } catch (e) {
        sentErr = e?.message || String(e);
      }
    } else {
      // Already confirmed -> the original sent a password recovery link;
      // Cognito equivalent is a password-reset email.
      mode = "recovery";
      try {
        await ctx.cognito.resetPassword(email);
      } catch (e) {
        sentErr = e?.message || String(e);
      }
    }

    if (sentErr) return ctx.json(500, { error: sentErr });

    return ctx.json(200, { ok: true, mode, email });
  } catch (e) {
    return ctx.json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
}
