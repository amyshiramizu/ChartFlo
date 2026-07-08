import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser, corsHeaders as sharedCors } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;

    const { transcript, lastAssessment, template } = await req.json();

    if (!transcript || transcript.trim().length === 0) {
      return new Response(JSON.stringify({ error: "No transcript provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const templateBlock = template
      ? `\n\nTEMPLATE GUIDANCE — Use the "${template.name}" template. Follow these per-section instructions exactly:
- Subjective: ${template.subjectivePrompt || '(no specific guidance)'}
- Objective: ${template.objectivePrompt || '(no specific guidance)'}
- Assessment: ${template.assessmentPrompt || '(no specific guidance)'}
- Plan: ${template.planPrompt || '(no specific guidance)'}`
      : '';

    const systemPrompt = `You are a medical scribe AI assistant producing CMS-audit-ready SOAP documentation from a patient-provider encounter transcript. Output five sections:

- **Chief Complaint (CC)**: A SHORT (≤ 12 words) patient-stated reason for the visit, in the patient's own words when possible (e.g. "Right knee pain x 3 days", "Follow-up CHF and diabetes", "Annual wellness visit"). Do NOT prefix with "CC:" or "Chief Complaint:" — return only the text. If the transcript truly contains no stated reason, return "Not documented". The CC must NOT appear inside the Subjective section.

- **Subjective**: Format using this EXACT structure:
  1. Start with a SINGLE PARAGRAPH that includes the patient's age, pertinent past medical history (PMH), and social history, followed by the relevant subjective content in paragraph form.
  2. Then detect any clinical information tied to a diagnosis from the transcript and organize the subjective content UNDER EACH DIAGNOSIS using this format:
     1. [Medical Problem / Diagnosis]
        Assessment/Diagnosis: [Diagnosis or working diagnosis]
        Subjective Information: [Symptoms, complaints, duration, related history, patient's description, etc.]
     2. [Next Medical Problem / Diagnosis]
        Assessment/Diagnosis: [Diagnosis or working diagnosis]
        Subjective Information: [...]
     Do NOT list vital signs within normal range as a diagnosis.
  3. Then include a Review of Systems (ROS) section listing the following systems, each on its own line, with findings from the transcript (use "Denies ..." or "Reports ..." phrasing); if a system was not addressed, state "Not assessed":
     - Constitutional:
     - Eyes:
     - ENT:
     - Cardiovascular:
     - Respiratory:
     - Gastrointestinal:
     - Genitourinary:
     - Musculoskeletal:
     - Neurological:
     - Psychiatric:
  4. End the Subjective with this line exactly:
     ROS: A complete 10-point review of systems was performed and is negative except where otherwise noted: [insert positive findings, or state "All systems negative"].
- **Objective**: MUST include the following 9 elements, in this EXACT order, with NO blank line between sections, each on its own line and prefixed with the label exactly as written:
  1. General:
  2. Psych:
  3. Eyes:
  4. ENT:
  5. Respiratory:
  6. CV:
  7. Abdomen:
  8. Skin:
  9. Neuro:
  Use these DEFAULT findings verbatim for any section not addressed in the transcript. When the transcript contains a positive finding, REMOVE any conflicting negative phrase from the default and replace it with the positive finding; keep all other default sentences intact. Default text by section:
  - General: No acute distress. Awake and conversant.
  - Psych: Alert and oriented. Cooperative, Appropriate mood and affect, Normal judgment.
  - Eyes: Normal conjunctiva, anicteric. Round symmetric pupils.
  - ENT: Hearing grossly intact. No nasal discharge. Oral mucosa is moist. Neck is supple. No masses or thyromegaly.
  - Respiratory: Respirations are non-labored. Lungs are clear to auscultation.
  - CV: Normal S1 and S2. No S3, S4 or murmurs. Rhythm is regular. There is no peripheral edema, cyanosis or pallor. Extremities are warm and well perfused. Capillary refill is less than 2 seconds.
  - Abdomen: Positive bowel sounds. Soft, nondistended, nontender. No guarding or rebound. No masses. MSK: Normal ambulation. No clubbing or cyanosis.
  - Skin: Warm and intact. No rashes or ulcers.
  - Neuro: Sensation and CN II-XII grossly normal.
  Vital signs (if documented) may be placed on a single line BEFORE "General:" but NEVER list "vital signs within normal range" as a diagnosis in the Assessment.
- **Assessment**: Numbered problem list. For EACH problem you MUST append the most specific ICD-10-CM diagnosis code in parentheses immediately after the problem name, e.g. "1. Hip pain, right (M25.551) - Improving. ...". If multiple codes are plausible, pick the single most clinically specific one supported by the transcript. Never omit the code. Then state the clinical impression and clearly document the status (stable / improving / worsening / new) to support medical necessity. Do NOT include normal vital signs as a diagnosis.
- **Plan**: Place the Plan directly beneath the Assessment. List every ICD-10 diagnosis from the Assessment in numbered format and under each diagnosis clearly list all relevant orders and recommendations specific to that diagnosis (labs/imaging/referrals; medications with name, dose, route, frequency, duration, refills; and patient education/counseling discussed). Do NOT add a "Follow-up:" line or follow-up interval. Do NOT cite "CMS 2021/2023 E/M guidelines" or E/M coding tiers. Recommendations MUST follow, in this order of priority: (1) the orders and plan explicitly stated by the provider in the transcript — never override or contradict them; (2) current AAFP clinical recommendations and AAFP Choosing Wisely guidance; (3) OpenEvidence-style evidence-based primary care guidance. After the per-diagnosis plans, append the following three blocks verbatim (fill in time when present in the transcript, otherwise leave the bracketed placeholder):\n\n  Medical decision-making during this visit was of moderate/high complexity, involving the evaluation and management of multiple problems, interpretation of diagnostic results, and formulation of a treatment plan. The visit required a detailed review of the patient's history, discussion of risks and benefits, and coordination of care.\n\n  Total time spent: [insert time here], including time spent reviewing records, interacting with the patient, and documenting the encounter.\n\n  Pt is homebound. It takes a taxing effort and pt relies on others to get out to office visits and qualifies for home visits. Discussed plan of care and symptoms at length with patient and orders as above. More than half of this patient's visit was spent face to face with patient/family/facility staff in counseling and/or coordination of care.\n\nFinally, append a "Suggested billing codes for optimal reimbursement (provider to verify):" section listing the most appropriate primary E/M or visit code and any add-on/G-codes supported by the documentation (e.g., G2211 visit complexity, G0506 care planning, G0444 depression screening, G0442 alcohol screening, G0136 SDOH assessment, G0438/G0439 AWV, 99497/99498 ACP, prolonged services G2212). Only suggest codes actually supported by what was documented.

CMS AUDIT COMPLIANCE RULES (must follow):
- Document medical necessity for every clinical decision — tie orders and meds back to a specific diagnosis.
- Never fabricate exam findings, vitals, ROS elements, or history not present in the transcript. If something was not addressed, write "not assessed" or "not documented" — do NOT invent normal findings.
- Use objective, third-person clinical language ("Patient reports..." not "I feel...").
- Avoid copy-forward of prior data unless explicitly re-verified in this encounter.
- Avoid abbreviations that are on the Joint Commission "Do Not Use" list (e.g., U, IU, QD, QOD, MS, MSO4, MgSO4, trailing zero, lack of leading zero).
- If a section has no relevant content from the transcript, write "Not addressed during this encounter." (do NOT invent content).
- Be concise but complete; use bullet points within sections when listing multiple items.${templateBlock}
${lastAssessment ? `\n- The patient's assessment from their last visit was: "${lastAssessment}". Reference it for continuity of care only if it was discussed/re-evaluated in this encounter.` : ''}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Here is the clinical encounter transcript:\n\n${transcript}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "structure_soap_note",
              description: "Structure the transcript into SOAP note format",
              parameters: {
                type: "object",
                properties: {
                  chief_complaint: { type: "string", description: "Short patient-stated reason for visit (≤12 words). No CC:/Chief Complaint: prefix. Must NOT also appear in subjective." },
                  subjective: { type: "string", description: "Subjective section of the SOAP note. Must NOT contain the chief complaint line." },
                  objective: { type: "string", description: "Objective section of the SOAP note" },
                  assessment: { type: "string", description: "Assessment section of the SOAP note" },
                  plan: { type: "string", description: "Plan section of the SOAP note" },
                },
                required: ["chief_complaint", "subjective", "objective", "assessment", "plan"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "structure_soap_note" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds in Settings > Workspace > Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway returned ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured output");
    }

    const soapNote = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(soapNote), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("structure-soap error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
