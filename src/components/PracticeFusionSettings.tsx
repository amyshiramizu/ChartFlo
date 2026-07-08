import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { FileText, Download, ExternalLink } from 'lucide-react';

interface PracticeFusionSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PracticeFusionSettings({ open, onOpenChange }: PracticeFusionSettingsProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Practice Fusion Integration
          </DialogTitle>
          <DialogDescription>
            Sync patient data to Practice Fusion using FHIR R4 exports — no extension needed
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Step 1 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">Step 1</Badge>
              <span className="text-sm font-medium">Export Patient as FHIR Bundle</span>
            </div>
            <p className="text-xs text-muted-foreground pl-14">
              Open any patient profile and click <strong>"Export FHIR"</strong> to download a standards-compliant FHIR R4 JSON bundle containing demographics, allergies, medications, and clinical notes.
            </p>
          </div>

          {/* Step 2 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">Step 2</Badge>
              <span className="text-sm font-medium">Import into Practice Fusion</span>
            </div>
            <p className="text-xs text-muted-foreground pl-14">
              Use Practice Fusion's <strong>patient import</strong> or <strong>Health Information Exchange (HIE)</strong> feature to import the FHIR bundle. This maps demographics, medications, allergies, and notes automatically.
            </p>
          </div>

          {/* Step 3 */}
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
      </DialogContent>
    </Dialog>
  );
}
