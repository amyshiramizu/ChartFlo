// Registry of Supabase edge functions ported to the Lambda router.
// The router injects { aiTool, aiText, json, sql, cognito } as the second
// (ctx) argument and the raw Lambda event as the third:
// handler(body, ctx, event). Handlers that need the caller's user id read
// event.requestContext.authorizer.jwt.claims["custom:legacy_id"].
import suggestIcd from "./suggest-icd.mjs";
import suggestCpt from "./suggest-cpt.mjs";
import suggestMips from "./suggest-mips.mjs";
import extractMedications from "./extract-medications.mjs";
import extractScreenings from "./extract-screenings.mjs";
import extractClinicalData from "./extract-clinical-data.mjs";
import generateAvs from "./generate-avs.mjs";
import generateCcmCarePlan from "./generate-ccm-care-plan.mjs";
import summarizeForFamily from "./summarize-for-family.mjs";
import groupPlanByDx from "./group-plan-by-dx.mjs";
import ccmLogAssist from "./ccm-log-assist.mjs";
import ccmBatchParse from "./ccm-batch-parse.mjs";
import codeLookup from "./code-lookup.mjs";
import transcribeAudio from "./transcribe-audio.mjs";
import computeMonthlySuperbill from "./compute-monthly-superbill.mjs";
import resolveActivePatient from "./resolve-active-patient.mjs";
import exportFhir from "./export-fhir.mjs";
import clinicMemberStatuses from "./clinic-member-statuses.mjs";
import inviteClinicMember from "./invite-clinic-member.mjs";
import resendClinicInvite from "./resend-clinic-invite.mjs";

export const PORTED = {
  "transcribe-audio": transcribeAudio,
  "suggest-icd": suggestIcd,
  "suggest-cpt": suggestCpt,
  "suggest-mips": suggestMips,
  "extract-medications": extractMedications,
  "extract-screenings": extractScreenings,
  "extract-clinical-data": extractClinicalData,
  "generate-avs": generateAvs,
  "generate-ccm-care-plan": generateCcmCarePlan,
  "summarize-for-family": summarizeForFamily,
  "group-plan-by-dx": groupPlanByDx,
  "ccm-log-assist": ccmLogAssist,
  "ccm-batch-parse": ccmBatchParse,
  "code-lookup": codeLookup,
  "compute-monthly-superbill": computeMonthlySuperbill,
  "resolve-active-patient": resolveActivePatient,
  "export-fhir": exportFhir,
  "clinic-member-statuses": clinicMemberStatuses,
  "invite-clinic-member": inviteClinicMember,
  "resend-clinic-invite": resendClinicInvite,
};
// Intentionally NOT ported (router 501s them):
// dispatch-sync, pf-oauth-token, pf-fhir-import, ingest-reading.
