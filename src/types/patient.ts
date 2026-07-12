export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  dob: string;
  mrn: string;
  gender: 'male' | 'female';
  phone?: string;
  allergies: string[];
  medications: Medication[];
  notes: ClinicalNote[];
  createdAt: string;
  provider?: string;
  location?: string;
  /** Defaults to 'active' when absent (e.g. rows created before the status migration). */
  status?: 'active' | 'inactive';
  insurance?: string;
  zipCode?: string;
  dischargeDate?: string;
}

export interface Medication {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  route: string;
  prescribedDate: string;
  active: boolean;
}

export interface ClinicalNote {
  id: string;
  date: string;
  type: 'soap' | 'progress' | 'procedure';
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  author: string;
  dictated: boolean;
}

export interface NoteTemplate {
  id: string;
  name: string;
  type: 'soap' | 'progress' | 'procedure';
  subjectivePrompt: string;
  objectivePrompt: string;
  assessmentPrompt: string;
  planPrompt: string;
}

export interface OrderSummary {
  id: string;
  patientName: string;
  date: string;
  orders: string[];
  facility: string;
  status: 'draft' | 'ready' | 'sent';
}
