// Port of supabase/functions/suggest-cpt — prompt preserved verbatim
// (see ../prompts/suggest-cpt.mjs).
import { SUGGEST_CPT_SYSTEM } from "../prompts/suggest-cpt.mjs";

export default async function handler(body, ctx) {
  const {
    subjective = "",
    objective = "",
    assessment = "",
    plan = "",
    diagnoses = [],
    patientStatus = "established", // "new" | "established"
    visitMinutes = null,            // total provider time on date of encounter
    setting = "home",               // "home" | "domiciliary" | "ALF" | "office"
    program = null,                 // "CCM" | "RPM" | "TCM" | null
  } = body;

  const visitText = [subjective, objective, assessment, plan].filter(Boolean).join("\n\n");

  if (!visitText.trim()) {
    return ctx.json(400, { error: "No visit content provided" });
  }

  const meta = {
    patientStatus,
    setting,
    visitMinutes,
    program,
    diagnoses: Array.isArray(diagnoses) ? diagnoses.slice(0, 10) : [],
  };

  const result = await ctx.aiTool({
    system: SUGGEST_CPT_SYSTEM,
    user: `Visit metadata:\n${JSON.stringify(meta, null, 2)}\n\nSOAP note:\n${visitText}`,
    toolName: "suggest_cpt_codes",
    schema: {
      type: "object",
      properties: {
        codes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string", description: "CPT or HCPCS code, e.g. 99349 or G0438" },
              description: { type: "string" },
              category: {
                type: "string",
                enum: ["E/M", "Prolonged", "Preventive", "AWV", "CCM", "RPM", "TCM", "BHI", "ACP", "Immunization", "Counseling", "Procedure", "Add-on", "Other"],
              },
              units: { type: "number" },
              modifiers: { type: "array", items: { type: "string" } },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              rationale: { type: "string", description: "Why this code is supported by the documentation" },
              time_or_mdm: { type: "string", description: "Time or MDM elements that justify the code" },
              est_revenue_usd: { type: "number", description: "Approximate Medicare reimbursement for this line in USD" },
            },
            required: ["code", "description", "category", "confidence", "rationale"],
            additionalProperties: false,
          },
        },
        documentation_gaps: {
          type: "array",
          items: { type: "string" },
          description: "What is missing from the note that, if added, would support a higher level or additional billable service",
        },
        estimated_total_rvu_band: {
          type: "string",
          enum: ["low", "moderate", "high", "unknown"],
          description: "Rough billing optimization band for this encounter",
        },
        estimated_total_revenue_usd: {
          type: "number",
          description: "Sum of est_revenue_usd across all recommended codes",
        },
      },
      required: ["codes", "documentation_gaps"],
      additionalProperties: false,
    },
    model: "fast",
  });

  return ctx.json(200, result);
}
