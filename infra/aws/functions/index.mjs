// ChartFlo functions router — Lambda port of the Supabase edge functions.
// Routed at /functions/v1/{name} behind a Cognito JWT authorizer (the
// gateway verifies tokens; handlers can trust event auth claims).
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({ region: 'us-east-2' });
const MODELS = {
  fast: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  smart: 'us.anthropic.claude-sonnet-4-6',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (status, body) => ({ statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Call Claude on Bedrock with a forced tool so the reply is guaranteed
 * structured JSON — the same contract the edge functions had with the
 * Lovable AI gateway's tool_choice.
 */
async function aiTool({ system, user, toolName, schema, model = 'smart', maxTokens = 4096 }) {
  const r = await bedrock.send(new ConverseCommand({
    modelId: MODELS[model],
    system: [{ text: system }],
    messages: [{ role: 'user', content: [{ text: user }] }],
    inferenceConfig: { maxTokens },
    toolConfig: {
      tools: [{ toolSpec: { name: toolName, inputSchema: { json: schema } } }],
      toolChoice: { tool: { name: toolName } },
    },
  }));
  const block = (r.output?.message?.content || []).find(c => c.toolUse);
  if (!block) throw new Error('AI did not return structured output');
  return block.toolUse.input;
}

// ─── structure-soap ──────────────────────────────────────
// Port of supabase/functions/structure-soap — prompt preserved verbatim.
import { STRUCTURE_SOAP_SYSTEM } from './prompts/structure-soap.mjs';

async function structureSoap(body) {
  const { transcript, lastAssessment, template } = body;
  if (!transcript || transcript.trim().length === 0) return json(400, { error: 'No transcript provided' });

  const templateBlock = template
    ? `\n\nTEMPLATE GUIDANCE — Use the "${template.name}" template. Follow these per-section instructions exactly:
- Subjective: ${template.subjectivePrompt || '(no specific guidance)'}
- Objective: ${template.objectivePrompt || '(no specific guidance)'}
- Assessment: ${template.assessmentPrompt || '(no specific guidance)'}
- Plan: ${template.planPrompt || '(no specific guidance)'}`
    : '';

  const system = STRUCTURE_SOAP_SYSTEM + templateBlock +
    (lastAssessment ? `\n- The patient's assessment from their last visit was: "${lastAssessment}". Reference it for continuity of care only if it was discussed/re-evaluated in this encounter.` : '');

  const soap = await aiTool({
    system,
    user: `Here is the clinical encounter transcript:\n\n${transcript}`,
    toolName: 'structure_soap_note',
    schema: {
      type: 'object',
      properties: {
        chief_complaint: { type: 'string', description: 'Short patient-stated reason for visit (≤12 words). No CC:/Chief Complaint: prefix. Must NOT also appear in subjective.' },
        subjective: { type: 'string', description: 'Subjective section of the SOAP note. Must NOT contain the chief complaint line.' },
        objective: { type: 'string', description: 'Objective section of the SOAP note' },
        assessment: { type: 'string', description: 'Assessment section of the SOAP note' },
        plan: { type: 'string', description: 'Plan section of the SOAP note' },
      },
      required: ['chief_complaint', 'subjective', 'objective', 'assessment', 'plan'],
    },
    model: 'smart',
  });
  return json(200, soap);
}

// ─── router ──────────────────────────────────────────────
const ROUTES = {
  'structure-soap': structureSoap,
};

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || 'POST';
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS };
  const name = (event.pathParameters?.proxy || event.rawPath || '').split('/').filter(Boolean).pop();
  const fn = ROUTES[name];
  if (!fn) return json(501, { error: `Function "${name}" not ported to AWS yet` });
  try {
    const body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : {};
    return await fn(body, event);
  } catch (e) {
    console.error(`${name} error:`, e);
    return json(500, { error: e.message || 'Unknown error' });
  }
};
