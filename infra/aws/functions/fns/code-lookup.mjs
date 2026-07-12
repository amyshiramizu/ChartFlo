// Port of supabase/functions/code-lookup — prompt preserved verbatim.

const SYSTEM_PROMPT = `You are a CPT/HCPCS and ICD-10 reference assistant similar to AAPC Codify.
Given a code or keyword, return up to 8 relevant matches.

For each match include:
- code: the exact CPT/HCPCS/ICD-10 code
- type: "CPT", "HCPCS", or "ICD10"
- description: official short descriptor
- category: short clinical category (e.g. "E/M Office", "Cardiovascular", "Preventive")
- rate2026_usd: Medicare 2026 national non-facility allowed amount in USD (CPT/HCPCS only; use the CY2026 PFS final rule; null if not separately payable or for ICD-10)
- hcc: CMS-HCC v28 risk-adjustment category if applicable (ICD-10 only; null otherwise)
- notes: brief documentation cues, common modifiers, NCCI/bundling hints, or coverage caveats
- official_descriptor: full long descriptor when materially different from "description"

Filter by type when the caller restricts to CPT, HCPCS, or ICD10. Be accurate; if unsure say so in "notes" and lower confidence. Do not invent codes. Prefer commonly-billed primary care, internal medicine, and care-management codes.`;

export default async function handler(body, ctx) {
  const { query = "", type = "ALL" } = body;
  if (!String(query).trim()) {
    return ctx.json(200, { results: [] });
  }

  const result = await ctx.aiTool({
    system: SYSTEM_PROMPT,
    user: `Type filter: ${type}\nQuery: ${query}`,
    toolName: "return_code_matches",
    schema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              type: { type: "string", enum: ["CPT", "HCPCS", "ICD10"] },
              description: { type: "string" },
              official_descriptor: { type: "string" },
              category: { type: "string" },
              rate2026_usd: { type: ["number", "null"] },
              hcc: { type: ["string", "null"] },
              notes: { type: "string" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["code", "type", "description", "confidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["results"],
      additionalProperties: false,
    },
    model: "fast",
  });

  return ctx.json(200, result);
}
