import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Sandbox base URLs
const SERVICE_URLS: Record<string, string> = {
  pf: 'https://api.patientfusion.com/fhir/r4/v1/b930bc01-3a8d-4b26-99ba-c1560177876b',
  fmh: 'https://api.practicefusion.com/fhir/fmh/r4/v1/0f4bdecd-1549-4acf-8255-2012323dc667',
};

interface FetchRequest {
  access_token: string;
  portal: 'pf' | 'fmh';
  patient_id: string;
}


async function fhirGet(baseUrl: string, path: string, token: string) {
  const response = await fetch(`${baseUrl}/${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/fhir+json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`FHIR GET ${path} failed [${response.status}]:`, errorText);
    return null;
  }

  return await response.json();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;

    const { access_token, portal, patient_id }: FetchRequest = await req.json();

    if (!access_token || !patient_id) {
      return new Response(
        JSON.stringify({ error: 'Missing access_token or patient_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // base_url is intentionally NOT accepted from the caller to prevent SSRF.
    // Only server-side allow-listed FHIR endpoints (SERVICE_URLS) are used.
    const baseUrl = SERVICE_URLS[portal] || SERVICE_URLS.pf;

    // Fetch patient demographics
    const patient = await fhirGet(baseUrl, `Patient/${patient_id}`, access_token);

    // Fetch allergies
    const allergies = await fhirGet(baseUrl, `AllergyIntolerance?patient=${patient_id}`, access_token);

    // Fetch medications
    const medications = await fhirGet(baseUrl, `MedicationRequest?patient=${patient_id}`, access_token);

    // Fetch conditions (for assessment context)
    const conditions = await fhirGet(baseUrl, `Condition?patient=${patient_id}`, access_token);

    // Fetch clinical notes (DocumentReference)
    const documents = await fhirGet(baseUrl, `DocumentReference?patient=${patient_id}`, access_token);

    // Fetch encounters
    const encounters = await fhirGet(baseUrl, `Encounter?patient=${patient_id}`, access_token);

    // Transform FHIR resources into Chart Flo format
    const transformed = transformToChartScribe(patient, allergies, medications, conditions, documents, encounters);

    return new Response(
      JSON.stringify(transformed),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('FHIR fetch error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function transformToChartScribe(
  patient: any,
  allergiesBundle: any,
  medsBundle: any,
  conditionsBundle: any,
  docsBundle: any,
  encountersBundle: any,
) {
  // Parse patient demographics
  const name = patient?.name?.[0] || {};
  const firstName = name.given?.[0] || '';
  const lastName = name.family || '';
  const dob = patient?.birthDate || '';
  const gender = patient?.gender || 'male';
  const phone = patient?.telecom?.find((t: any) => t.system === 'phone')?.value || '';
  const mrn = patient?.identifier?.find(
    (id: any) => id.type?.coding?.some((c: any) => c.code === 'MR')
  )?.value || `PF-${patient?.id?.substring(0, 8) || 'unknown'}`;

  // Parse allergies
  const allergies: string[] = (allergiesBundle?.entry || [])
    .map((e: any) => e.resource?.code?.text || e.resource?.code?.coding?.[0]?.display || '')
    .filter(Boolean);

  // Parse medications
  const medications = (medsBundle?.entry || []).map((e: any) => {
    const med = e.resource;
    const medName = med?.medicationCodeableConcept?.text ||
      med?.medicationCodeableConcept?.coding?.[0]?.display || 'Unknown';

    const dosageInstr = med?.dosageInstruction?.[0];
    const dosage = dosageInstr?.doseAndRate?.[0]?.doseQuantity
      ? `${dosageInstr.doseAndRate[0].doseQuantity.value}${dosageInstr.doseAndRate[0].doseQuantity.unit || ''}`
      : dosageInstr?.text || '';

    const frequency = dosageInstr?.timing?.code?.text ||
      dosageInstr?.timing?.repeat?.frequency
        ? `${dosageInstr?.timing?.repeat?.frequency}x/${dosageInstr?.timing?.repeat?.period || ''}${dosageInstr?.timing?.repeat?.periodUnit || ''}`
        : '';

    const route = dosageInstr?.route?.text ||
      dosageInstr?.route?.coding?.[0]?.display || 'PO';

    return {
      id: med?.id || crypto.randomUUID(),
      name: medName,
      dosage,
      frequency,
      route,
      prescribedDate: med?.authoredOn?.split('T')[0] || new Date().toISOString().split('T')[0],
      active: med?.status === 'active',
    };
  });

  // Parse conditions into assessment text
  const conditions = (conditionsBundle?.entry || [])
    .map((e: any) => {
      const c = e.resource;
      const name = c?.code?.text || c?.code?.coding?.[0]?.display || '';
      const status = c?.clinicalStatus?.coding?.[0]?.code || '';
      return name ? `${name} (${status})` : '';
    })
    .filter(Boolean);

  // Parse documents into clinical notes
  const notes = (docsBundle?.entry || []).map((e: any) => {
    const doc = e.resource;
    const content = doc?.content?.[0]?.attachment;
    let noteText = '';

    if (content?.data) {
      try {
        noteText = atob(content.data);
      } catch {
        noteText = content.data;
      }
    }

    return {
      id: doc?.id || crypto.randomUUID(),
      date: doc?.date?.split('T')[0] || new Date().toISOString().split('T')[0],
      type: 'soap' as const,
      subjective: noteText || '',
      objective: '',
      assessment: conditions.join('\n'),
      plan: '',
      author: doc?.author?.[0]?.display || 'Practice Fusion',
      dictated: false,
    };
  });

  return {
    firstName,
    lastName,
    dob,
    mrn,
    gender: gender === 'female' ? 'female' : 'male',
    phone,
    allergies,
    medications,
    notes,
    conditions,
  };
}
