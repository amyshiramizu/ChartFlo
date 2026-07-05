import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser, corsHeaders as sharedCors } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;

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
    } = await req.json();

    const visitText = [subjective, objective, assessment, plan].filter(Boolean).join("\n\n");

    if (!visitText.trim()) {
      return new Response(JSON.stringify({ error: "No visit content provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are a CPT/HCPCS coding assistant specialized in MOBILE / HOME-BASED PRIMARY CARE.
Given a SOAP note plus visit metadata, recommend the optimal CPT/HCPCS codes that maximize compliant reimbursement WITHOUT upcoding.

All reimbursement figures below are Medicare 2026 NATIONAL NON-FACILITY allowed amounts from the CY2026 PFS final rule (conversion factor ~$33.42 non-QP / ~$33.59 QP). Adjust expectations for locality (GPCI), modifiers, and APM status.

Key code families to consider when relevant:

HOME / DOMICILIARY E/M (use these for mobile primary care in a patient's home, ALF, group home, custodial care):
- New patient home/residence E/M: 99341 (low MDM or 15 min), 99342 (low / 30 min), 99344 (moderate / 60 min), 99345 (high / 75 min)
- Established home/residence E/M: 99347 (straightforward / 20 min), 99348 (low / 30 min), 99349 (moderate / 40 min), 99350 (high / 60 min)
- Prolonged home/outpatient (each additional 15 min beyond minimum threshold of highest-level code): 99417 (commercial / non-Medicare) or G2212 Medicare (~$32.91 2026). Only add when total time clearly exceeds the threshold.

MEDICARE WELLNESS / PREVENTIVE / ACP (2026 rates):
- G0438 Initial AWV (~$165.42), G0439 Subsequent AWV (~$131.27), G0468 FQHC AWV (~$236.18), G0402 IPPE (~$174.83)
- G0444 Annual depression screen, G0442 Annual alcohol screen, G0443 brief alcohol counseling
- 99497 Advance Care Planning first 30 min (~$84.92) (+99498 each addl 30 min ~$74.81)
- 99483 Cognitive Assessment & Care Plan, ≥50 min (~$271.95)

E/M ADD-ONS (commonly missed) — 2026 rates:
- G2211 Visit complexity add-on for ongoing longitudinal care of a serious/complex condition (~$16.05); append to office or home E/M when the visit is part of continuous care
- G0506 Comprehensive care-plan add-on at CCM initiating visit (~$64.18)
- Modifier 25 on E/M when a separately identifiable procedure is performed same day

CHRONIC CARE / CARE MANAGEMENT (2026 rates):
- 99490 CCM clinical-staff 20 min/mo (~$60.49), 99439 each addl 20 min (~$45.93, max 2 units)
- 99491 CCM provider 30 min (~$76.94), 99437 each addl 30 min provider (~$57.94)
- 99487 Complex CCM 60 min (~$128.42), 99489 each addl 30 min (~$69.18)  ← billing family for the "CCO" (Complex Care Oversight) program
- 99424 PCM provider 30 min (~$81.18), 99425 each addl 30 (~$58.62), 99426 PCM staff 30 (~$60.83), 99427 each addl 30 (~$47.95)
- G0511 RHC/FQHC care-management bundle (~$72.43)
- APCM (NEW for 2025, refined 2026 — no time threshold, monthly per beneficiary):
    • G0556 APCM Level 1, single chronic condition (~$15.20)
    • G0557 APCM Level 2, ≥2 chronic conditions (~$50.10)
    • G0558 APCM Level 3, QMB / dual-eligible with ≥2 chronic (~$110.42)
  APCM cannot be billed in the same calendar month as 99490/99439/99491/99437/99487/99489 or PCM 99424–99427 for the same beneficiary.
- TCM: 99495 moderate, 14-day f/u (~$202.17); 99496 high, 7-day f/u (~$271.83)

RPM / RTM (only if device data referenced) — 2026 rates:
- 99453 setup (~$19.04), 99454 device 30-day with ≥16 days of readings (~$43.02), 99457 first 20 min/mo (~$48.14), 99458 each addl 20 (~$38.49, max 2 units)
- 99091 Collection and interpretation of physiologic data by a physician/QHP, ≥30 min/30 days (~$53.16)
- RTM: 98975 setup (~$18.71), 98976 respiratory device 30d (~$42.36), 98977 MSK device 30d (~$42.36), 98980 first 20 min (~$47.13), 98981 addl 20 min (~$37.81)

BEHAVIORAL HEALTH INTEGRATION (2026 rates): 99484 BHI 20 min (~$47.97), 99492 CoCM initial 70 min (~$162.34), 99493 CoCM subseq 60 min (~$129.07), 99494 addl 30 min (~$65.93)

SAME-DAY ADD-ONS commonly missed:
- 90471/90472 immunization administration (+ vaccine product code)
- 96127 brief emotional/behavioral assessment (PHQ-9, GAD-7)
- 99406/99407 tobacco counseling
- G0108/G0109 diabetes self-mgmt training


RULES:
- Recommend ONE primary E/M code from the home/domiciliary family (99341-99350) unless the documented setting is clearly office (then 99202-99215).
- Justify the E/M level using BOTH 2023 MDM (Problems addressed + Data reviewed + Risk) AND total time, citing what in the note supports it.
- If visitMinutes is provided AND exceeds the threshold for the highest base code, add the appropriate prolonged code with the exact units.
- Add G2211 only when the note shows ongoing longitudinal/continuous care of a single serious or complex condition by this provider. Do not add G2211 with global-period procedures or modifier 25.
- Add 99483 only when the note documents a full cognitive assessment (standardized tool, functional/safety assessment, medication review, caregiver identification, and a written care plan), typically ≥50 minutes.
- Add 99091 only when the note explicitly shows ≥30 minutes of physician/QHP collection and interpretation of physiologic data over the prior 30 days, and not double-billed with 99457 in the same period unless clearly distinct.
- If program is "CCO": treat it as Complex CCM. Recommend 99487 when ≥60 min of clinical staff care-coordination is documented for a patient with multiple chronic conditions and moderate/high MDM, then 99489 for each additional 30 min. Do not stack 99490/99439 with 99487/99489 in the same calendar month.
- Consider APCM (G0556/G0557/G0558) as an alternative monthly bundle when the practice has elected APCM for the beneficiary; never stack APCM with CCM/PCM in the same month.
- Add care-management / preventive / RPM / immunization / counseling codes ONLY if the note clearly documents the required elements (time, content, device data, vaccine given, etc.). Never assume.
- Provide an est_revenue_usd per code using the Medicare 2026 national non-facility amounts above. Sum into estimated_total_revenue_usd.
- Flag any documentation that is MISSING but would unlock a higher level or an add-on code, under "documentation_gaps".
- Return 1-8 codes ordered by billing priority (primary E/M first).
- Be conservative and CMS-compliant. Do not invent services that aren't documented.`;

    const meta = {
      patientStatus,
      setting,
      visitMinutes,
      program,
      diagnoses: Array.isArray(diagnoses) ? diagnoses.slice(0, 10) : [],
    };

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Visit metadata:\n${JSON.stringify(meta, null, 2)}\n\nSOAP note:\n${visitText}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "suggest_cpt_codes",
              description: "Return CPT/HCPCS code recommendations for billing this encounter",
              parameters: {
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
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "suggest_cpt_codes" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds in Settings > Workspace > Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway returned ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("AI did not return structured output");

    const result = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-cpt error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
