import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PatientData {
  firstName: string;
  lastName: string;
  dob: string;
  mrn: string;
  gender: string;
  phone?: string;
  allergies: string[];
  medications: {
    name: string;
    dosage: string;
    frequency: string;
    route: string;
    prescribedDate: string;
    active: boolean;
  }[];
  notes: {
    date: string;
    type: string;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    author: string;
  }[];
}

function buildFHIRBundle(patient: PatientData): object {
  const patientId = `patient-${patient.mrn}`;

  const patientResource = {
    resourceType: "Patient",
    id: patientId,
    identifier: [
      {
        type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] },
        value: patient.mrn,
      },
    ],
    name: [{ family: patient.lastName, given: [patient.firstName] }],
    gender: patient.gender === "male" ? "male" : "female",
    birthDate: patient.dob,
    telecom: patient.phone
      ? [{ system: "phone", value: patient.phone, use: "home" }]
      : [],
  };

  const allergyResources = patient.allergies.map((allergy, i) => ({
    resourceType: "AllergyIntolerance",
    id: `allergy-${i}`,
    clinicalStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
    },
    patient: { reference: `Patient/${patientId}` },
    code: { text: allergy },
  }));

  const medResources = patient.medications.map((med, i) => ({
    resourceType: "MedicationStatement",
    id: `med-${i}`,
    status: med.active ? "active" : "stopped",
    medicationCodeableConcept: { text: `${med.name} ${med.dosage}` },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: med.prescribedDate,
    dosage: [
      {
        text: `${med.dosage} ${med.frequency} ${med.route}`,
        route: { text: med.route },
        timing: { code: { text: med.frequency } },
      },
    ],
  }));

  const noteResources = patient.notes.map((note, i) => ({
    resourceType: "DocumentReference",
    id: `note-${i}`,
    status: "current",
    type: {
      coding: [
        {
          system: "http://loinc.org",
          code: note.type === "soap" ? "11506-3" : note.type === "progress" ? "11506-3" : "28570-0",
          display: note.type === "soap" ? "Progress note" : note.type === "progress" ? "Progress note" : "Procedure note",
        },
      ],
    },
    subject: { reference: `Patient/${patientId}` },
    date: note.date,
    author: [{ display: note.author }],
    content: [
      {
        attachment: {
          contentType: "text/plain",
          data: btoa(
            `SUBJECTIVE:\n${note.subjective}\n\nOBJECTIVE:\n${note.objective}\n\nASSESSMENT:\n${note.assessment}\n\nPLAN:\n${note.plan}`
          ),
        },
      },
    ],
  }));

  return {
    resourceType: "Bundle",
    type: "document",
    timestamp: new Date().toISOString(),
    entry: [
      { resource: patientResource, fullUrl: `urn:uuid:${patientId}` },
      ...allergyResources.map((r) => ({ resource: r, fullUrl: `urn:uuid:${r.id}` })),
      ...medResources.map((r) => ({ resource: r, fullUrl: `urn:uuid:${r.id}` })),
      ...noteResources.map((r) => ({ resource: r, fullUrl: `urn:uuid:${r.id}` })),
    ],
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const patient: PatientData = await req.json();

    if (!patient.firstName || !patient.lastName || !patient.mrn) {
      return new Response(JSON.stringify({ error: "Missing required patient fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bundle = buildFHIRBundle(patient);

    return new Response(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
