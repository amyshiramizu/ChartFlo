export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      care_plan_templates: {
        Row: {
          content: string
          created_at: string
          id: string
          name: string
          program: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          name: string
          program?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          name?: string
          program?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ccm_time_entries: {
        Row: {
          created_at: string
          date: string
          description: string | null
          id: string
          minutes: number
          patient_id: string
          program: string
          staff: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          description?: string | null
          id?: string
          minutes?: number
          patient_id: string
          program?: string
          staff?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          description?: string | null
          id?: string
          minutes?: number
          patient_id?: string
          program?: string
          staff?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ccm_time_entries_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_members: {
        Row: {
          clinic_id: string
          id: string
          invited_at: string
          role: string
          user_id: string
        }
        Insert: {
          clinic_id: string
          id?: string
          invited_at?: string
          role?: string
          user_id: string
        }
        Update: {
          clinic_id?: string
          id?: string
          invited_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_members_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_settings: {
        Row: {
          auto_pf_push_enabled: boolean
          auto_pf_push_time: string
          brand_address: string
          brand_fax: string
          brand_name: string
          brand_phone: string
          clinic_id: string
          created_at: string
          default_location: string
          default_program: string
          favicon_url: string
          id: string
          logo_url: string
          signature_block: string
          updated_at: string
        }
        Insert: {
          auto_pf_push_enabled?: boolean
          auto_pf_push_time?: string
          brand_address?: string
          brand_fax?: string
          brand_name?: string
          brand_phone?: string
          clinic_id: string
          created_at?: string
          default_location?: string
          default_program?: string
          favicon_url?: string
          id?: string
          logo_url?: string
          signature_block?: string
          updated_at?: string
        }
        Update: {
          auto_pf_push_enabled?: boolean
          auto_pf_push_time?: string
          brand_address?: string
          brand_fax?: string
          brand_name?: string
          brand_phone?: string
          clinic_id?: string
          created_at?: string
          default_location?: string
          default_program?: string
          favicon_url?: string
          id?: string
          logo_url?: string
          signature_block?: string
          updated_at?: string
        }
        Relationships: []
      }
      clinical_notes: {
        Row: {
          assessment: string | null
          author: string | null
          date: string
          dictated: boolean | null
          id: string
          objective: string | null
          patient_id: string
          plan: string | null
          subjective: string | null
          type: string
        }
        Insert: {
          assessment?: string | null
          author?: string | null
          date: string
          dictated?: boolean | null
          id?: string
          objective?: string | null
          patient_id: string
          plan?: string | null
          subjective?: string | null
          type?: string
        }
        Update: {
          assessment?: string | null
          author?: string | null
          date?: string
          dictated?: boolean | null
          id?: string
          objective?: string | null
          patient_id?: string
          plan?: string | null
          subjective?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_notes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      dispatch_batches: {
        Row: {
          created_at: string
          default_chart_type: string
          id: string
          instructions: string | null
          label: string | null
          session_date: string
          share_code: string
          shift_ended_at: string | null
          shift_seconds: number
          shift_started_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          default_chart_type?: string
          id?: string
          instructions?: string | null
          label?: string | null
          session_date?: string
          share_code: string
          shift_ended_at?: string | null
          shift_seconds?: number
          shift_started_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          default_chart_type?: string
          id?: string
          instructions?: string | null
          label?: string | null
          session_date?: string
          share_code?: string
          shift_ended_at?: string | null
          shift_seconds?: number
          shift_started_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      dispatch_jobs: {
        Row: {
          actual_minutes: number
          assessment: string | null
          batch_id: string
          chart_type: string
          completed_at: string | null
          created_at: string
          filled_at: string | null
          id: string
          mrn: string | null
          objective: string | null
          patient_id: string | null
          patient_name: string | null
          plan: string | null
          position: number
          started_at: string | null
          status: string
          subjective: string | null
        }
        Insert: {
          actual_minutes?: number
          assessment?: string | null
          batch_id: string
          chart_type?: string
          completed_at?: string | null
          created_at?: string
          filled_at?: string | null
          id?: string
          mrn?: string | null
          objective?: string | null
          patient_id?: string | null
          patient_name?: string | null
          plan?: string | null
          position?: number
          started_at?: string | null
          status?: string
          subjective?: string | null
        }
        Update: {
          actual_minutes?: number
          assessment?: string | null
          batch_id?: string
          chart_type?: string
          completed_at?: string | null
          created_at?: string
          filled_at?: string | null
          id?: string
          mrn?: string | null
          objective?: string | null
          patient_id?: string | null
          patient_name?: string | null
          plan?: string | null
          position?: number
          started_at?: string | null
          status?: string
          subjective?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_jobs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "dispatch_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_jobs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      eligibility_decision_logs: {
        Row: {
          ai_model: string | null
          care_plan_focus: string | null
          confidence: string | null
          cpt_hcpcs_rules: Json
          created_at: string
          eligible: boolean
          id: string
          note_excerpts: Json
          patient_id: string | null
          program: string
          qualifying_icd_codes: Json
          rationale: string | null
          raw_response: Json | null
          user_id: string
        }
        Insert: {
          ai_model?: string | null
          care_plan_focus?: string | null
          confidence?: string | null
          cpt_hcpcs_rules?: Json
          created_at?: string
          eligible: boolean
          id?: string
          note_excerpts?: Json
          patient_id?: string | null
          program: string
          qualifying_icd_codes?: Json
          rationale?: string | null
          raw_response?: Json | null
          user_id: string
        }
        Update: {
          ai_model?: string | null
          care_plan_focus?: string | null
          confidence?: string | null
          cpt_hcpcs_rules?: Json
          created_at?: string
          eligible?: boolean
          id?: string
          note_excerpts?: Json
          patient_id?: string | null
          program?: string
          qualifying_icd_codes?: Json
          rationale?: string | null
          raw_response?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      medications: {
        Row: {
          active: boolean | null
          dosage: string
          frequency: string
          id: string
          name: string
          patient_id: string
          prescribed_date: string
          route: string
        }
        Insert: {
          active?: boolean | null
          dosage: string
          frequency: string
          id?: string
          name: string
          patient_id: string
          prescribed_date: string
          route?: string
        }
        Update: {
          active?: boolean | null
          dosage?: string
          frequency?: string
          id?: string
          name?: string
          patient_id?: string
          prescribed_date?: string
          route?: string
        }
        Relationships: [
          {
            foreignKeyName: "medications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_superbills: {
        Row: {
          apcm_level: string | null
          apcm_recommended: boolean
          clinic_id: string | null
          codes_jsonb: Json
          created_at: string
          created_by: string | null
          evidence_jsonb: Json
          finalized_at: string | null
          id: string
          month: string
          notes: string | null
          patient_id: string
          projected_revenue_cents: number
          updated_at: string
        }
        Insert: {
          apcm_level?: string | null
          apcm_recommended?: boolean
          clinic_id?: string | null
          codes_jsonb?: Json
          created_at?: string
          created_by?: string | null
          evidence_jsonb?: Json
          finalized_at?: string | null
          id?: string
          month: string
          notes?: string | null
          patient_id: string
          projected_revenue_cents?: number
          updated_at?: string
        }
        Update: {
          apcm_level?: string | null
          apcm_recommended?: boolean
          clinic_id?: string | null
          codes_jsonb?: Json
          created_at?: string
          created_by?: string | null
          evidence_jsonb?: Json
          finalized_at?: string | null
          id?: string
          month?: string
          notes?: string | null
          patient_id?: string
          projected_revenue_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_superbills_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_superbills_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      note_templates: {
        Row: {
          assessment_prompt: string | null
          id: string
          name: string
          objective_prompt: string | null
          plan_prompt: string | null
          subjective_prompt: string | null
          type: string
          user_id: string
        }
        Insert: {
          assessment_prompt?: string | null
          id?: string
          name: string
          objective_prompt?: string | null
          plan_prompt?: string | null
          subjective_prompt?: string | null
          type?: string
          user_id: string
        }
        Update: {
          assessment_prompt?: string | null
          id?: string
          name?: string
          objective_prompt?: string | null
          plan_prompt?: string | null
          subjective_prompt?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      patient_assessments: {
        Row: {
          assessment_type: string
          cadence: string
          completed_at: string | null
          due_date: string | null
          id: string
          notes: string | null
          patient_id: string
          status: string
          updated_at: string
        }
        Insert: {
          assessment_type: string
          cadence?: string
          completed_at?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          patient_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          assessment_type?: string
          cadence?: string
          completed_at?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          patient_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      patient_avs: {
        Row: {
          clinic_id: string | null
          created_at: string
          created_by: string | null
          id: string
          language: string
          note_id: string | null
          patient_id: string
          reading_level: string
          summary_md: string
        }
        Insert: {
          clinic_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          language?: string
          note_id?: string | null
          patient_id: string
          reading_level?: string
          summary_md: string
        }
        Update: {
          clinic_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          language?: string
          note_id?: string | null
          patient_id?: string
          reading_level?: string
          summary_md?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_avs_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_avs_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "clinical_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_avs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_care_plans: {
        Row: {
          data: Json
          id: string
          next_review_date: string | null
          patient_id: string
          problem_plans: Json
          shared_date: string | null
          shared_method: string | null
          shared_with_patient: boolean | null
          updated_at: string
        }
        Insert: {
          data?: Json
          id?: string
          next_review_date?: string | null
          patient_id: string
          problem_plans?: Json
          shared_date?: string | null
          shared_method?: string | null
          shared_with_patient?: boolean | null
          updated_at?: string
        }
        Update: {
          data?: Json
          id?: string
          next_review_date?: string | null
          patient_id?: string
          problem_plans?: Json
          shared_date?: string | null
          shared_method?: string | null
          shared_with_patient?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
      patient_enrollments: {
        Row: {
          enrolled_at: string
          id: string
          patient_id: string
          program: string
          status: string
        }
        Insert: {
          enrolled_at?: string
          id?: string
          patient_id: string
          program: string
          status?: string
        }
        Update: {
          enrolled_at?: string
          id?: string
          patient_id?: string
          program?: string
          status?: string
        }
        Relationships: []
      }
      patient_problems: {
        Row: {
          created_at: string
          description: string
          icd_code: string
          id: string
          patient_id: string
          program_tag: string | null
        }
        Insert: {
          created_at?: string
          description: string
          icd_code: string
          id?: string
          patient_id: string
          program_tag?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          icd_code?: string
          id?: string
          patient_id?: string
          program_tag?: string | null
        }
        Relationships: []
      }
      patient_vitals: {
        Row: {
          a1c: string | null
          afib_detected: boolean | null
          blood_glucose: string | null
          blood_pressure: string | null
          heart_rate: string | null
          height: string | null
          id: string
          o2_saturation: string | null
          patient_id: string
          recorded_at: string
          respiratory_rate: string | null
          source: string | null
          weight: string | null
        }
        Insert: {
          a1c?: string | null
          afib_detected?: boolean | null
          blood_glucose?: string | null
          blood_pressure?: string | null
          heart_rate?: string | null
          height?: string | null
          id?: string
          o2_saturation?: string | null
          patient_id: string
          recorded_at?: string
          respiratory_rate?: string | null
          source?: string | null
          weight?: string | null
        }
        Update: {
          a1c?: string | null
          afib_detected?: boolean | null
          blood_glucose?: string | null
          blood_pressure?: string | null
          heart_rate?: string | null
          height?: string | null
          id?: string
          o2_saturation?: string | null
          patient_id?: string
          recorded_at?: string
          respiratory_rate?: string | null
          source?: string | null
          weight?: string | null
        }
        Relationships: []
      }
      patients: {
        Row: {
          allergies: string[] | null
          clinic_id: string | null
          created_at: string | null
          dob: string
          first_name: string
          gender: string
          id: string
          last_name: string
          location: string | null
          mrn: string
          phone: string | null
          provider: string | null
          user_id: string
        }
        Insert: {
          allergies?: string[] | null
          clinic_id?: string | null
          created_at?: string | null
          dob: string
          first_name: string
          gender?: string
          id?: string
          last_name: string
          location?: string | null
          mrn: string
          phone?: string | null
          provider?: string | null
          user_id: string
        }
        Update: {
          allergies?: string[] | null
          clinic_id?: string | null
          created_at?: string | null
          dob?: string
          first_name?: string
          gender?: string
          id?: string
          last_name?: string
          location?: string | null
          mrn?: string
          phone?: string | null
          provider?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      pf_push_queue: {
        Row: {
          assessment: string | null
          clinic_id: string | null
          created_at: string
          encounter_date: string
          error: string | null
          id: string
          minutes: number
          mrn: string | null
          note: string
          objective: string | null
          patient_dob: string | null
          patient_id: string | null
          patient_name: string
          plan: string | null
          processed_at: string | null
          program: string
          status: string
          subjective: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          assessment?: string | null
          clinic_id?: string | null
          created_at?: string
          encounter_date?: string
          error?: string | null
          id?: string
          minutes?: number
          mrn?: string | null
          note?: string
          objective?: string | null
          patient_dob?: string | null
          patient_id?: string | null
          patient_name: string
          plan?: string | null
          processed_at?: string | null
          program?: string
          status?: string
          subjective?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          assessment?: string | null
          clinic_id?: string | null
          created_at?: string
          encounter_date?: string
          error?: string | null
          id?: string
          minutes?: number
          mrn?: string | null
          note?: string
          objective?: string | null
          patient_dob?: string | null
          patient_id?: string | null
          patient_name?: string
          plan?: string | null
          processed_at?: string | null
          program?: string
          status?: string
          subjective?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rpm_devices: {
        Row: {
          assigned_date: string
          created_at: string
          device_type: string
          id: string
          model: string | null
          notes: string | null
          patient_id: string
          serial_number: string | null
          status: string
        }
        Insert: {
          assigned_date?: string
          created_at?: string
          device_type: string
          id?: string
          model?: string | null
          notes?: string | null
          patient_id: string
          serial_number?: string | null
          status?: string
        }
        Update: {
          assigned_date?: string
          created_at?: string
          device_type?: string
          id?: string
          model?: string | null
          notes?: string | null
          patient_id?: string
          serial_number?: string | null
          status?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          default_clinic_id: string | null
          default_location: string | null
          default_program: string | null
          default_template_id: string | null
          signature: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          default_clinic_id?: string | null
          default_location?: string | null
          default_program?: string | null
          default_template_id?: string | null
          signature?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          default_clinic_id?: string | null
          default_location?: string | null
          default_program?: string | null
          default_template_id?: string | null
          signature?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_default_clinic_id_fkey"
            columns: ["default_clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_clinic_admin: {
        Args: { _clinic_id: string; _user_id: string }
        Returns: boolean
      }
      is_clinic_member: {
        Args: { _clinic_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
