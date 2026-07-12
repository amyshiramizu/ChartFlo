// Registry of Supabase edge functions ported to the Lambda router.
// The router injects { aiTool, aiText, json } as the second (ctx) argument
// of each handler: handler(body, ctx).
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
};
