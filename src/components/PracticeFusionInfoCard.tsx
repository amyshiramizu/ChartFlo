import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Download, ExternalLink } from 'lucide-react';

export function PracticeFusionInfoCard() {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-1">
        <FileText className="w-5 h-5" />
        <h2 className="text-base font-semibold">Practice Fusion Integration</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Sync patient data to Practice Fusion using FHIR R4 exports — no extension needed.
      </p>

      <div className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">Step 1</Badge>
            <span className="text-sm font-medium">Export Patient as FHIR Bundle</span>
          </div>
          <p className="text-xs text-muted-foreground pl-14">
            Open any patient profile and click <strong>"Export FHIR"</strong> to download a standards-compliant FHIR R4 JSON bundle containing demographics, allergies, medications, and clinical notes.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">Step 2</Badge>
            <span className="text-sm font-medium">Import into Practice Fusion</span>
          </div>
          <p className="text-xs text-muted-foreground pl-14">
            Use Practice Fusion's <strong>patient import</strong> or <strong>Health Information Exchange (HIE)</strong> feature to import the FHIR bundle. This maps demographics, medications, allergies, and notes automatically.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">Step 3</Badge>
            <span className="text-sm font-medium">Verify imported data</span>
          </div>
          <p className="text-xs text-muted-foreground pl-14">
            After import, review the patient chart in Practice Fusion to confirm all SOAP notes, medications, and allergies transferred correctly.
          </p>
        </div>

        <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-2">
          <div className="flex items-start gap-2">
            <Download className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              <strong>FHIR R4 format</strong> is the healthcare industry standard supported by Practice Fusion, Epic, Cerner, and most modern EHR systems.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <ExternalLink className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              The exported bundle includes: Patient demographics, AllergyIntolerance, MedicationStatement, and DocumentReference resources.
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
