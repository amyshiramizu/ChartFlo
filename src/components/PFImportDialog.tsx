import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePatientStore } from '@/store/patientStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Download, Loader2, CheckCircle, User, Pill, FileText, AlertTriangle } from 'lucide-react';

interface PFImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ImportStep = 'portal' | 'authorize' | 'loading' | 'preview' | 'done';

const PF_AUTHORIZE_URL = 'https://api.patientfusion.com/oauth2/authorize';
const FMH_AUTHORIZE_URL = 'https://api.practicefusion.com/oauth2/authorize';

export function PFImportDialog({ open, onOpenChange }: PFImportDialogProps) {
  const [step, setStep] = useState<ImportStep>('portal');
  const [portal, setPortal] = useState<'pf' | 'fmh'>('pf');
  const [importData, setImportData] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const { addPatient } = usePatientStore();

  // Listen for OAuth callback
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'pf-oauth-callback' && event.data?.code) {
        setStep('loading');
        try {
          // Exchange code for token
          const { data: tokenData, error: tokenError } = await supabase.functions.invoke('pf-oauth-token', {
            body: {
              code: event.data.code,
              redirect_uri: `${window.location.origin}/pf-callback`,
              portal,
            },
          });

          if (tokenError) throw tokenError;
          if (tokenData.error) throw new Error(tokenData.error);

          // Fetch patient data
          const { data: patientData, error: fetchError } = await supabase.functions.invoke('pf-fhir-import', {
            body: {
              access_token: tokenData.access_token,
              portal,
              patient_id: tokenData.patient,
            },
          });

          if (fetchError) throw fetchError;
          if (patientData.error) throw new Error(patientData.error);

          setImportData(patientData);
          setStep('preview');
        } catch (err: any) {
          toast.error('Import failed: ' + (err.message || 'Unknown error'));
          setStep('portal');
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [portal]);

  const handleAuthorize = () => {
    const clientId = import.meta.env.VITE_PF_CLIENT_ID;
    if (!clientId) {
      toast.error('Practice Fusion Client ID not configured');
      return;
    }

    const redirectUri = `${window.location.origin}/pf-callback`;
    const scope = 'patient/Patient.read patient/AllergyIntolerance.read patient/MedicationRequest.read patient/Condition.read patient/DocumentReference.read patient/Encounter.read openid fhirUser launch/patient';
    const authUrl = portal === 'fmh' ? FMH_AUTHORIZE_URL : PF_AUTHORIZE_URL;

    const url = `${authUrl}?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&aud=${encodeURIComponent(portal === 'fmh' ? 'https://api.practicefusion.com/fhir/fmh/r4/v1/0f4bdecd-1549-4acf-8255-2012323dc667' : 'https://api.patientfusion.com/fhir/r4/v1/b930bc01-3a8d-4b26-99ba-c1560177876b')}`;

    // Open popup for OAuth
    const popup = window.open(url, 'pf-auth', 'width=600,height=700,scrollbars=yes');
    if (!popup) {
      toast.error('Popup blocked. Please allow popups for this site.');
    }
    setStep('authorize');
  };

  const handleImport = async () => {
    if (!importData) return;
    setImporting(true);

    try {
      await addPatient({
        id: crypto.randomUUID(),
        firstName: importData.firstName,
        lastName: importData.lastName,
        dob: importData.dob,
        mrn: importData.mrn,
        gender: importData.gender,
        phone: importData.phone,
        allergies: importData.allergies || [],
        createdAt: new Date().toISOString().split('T')[0],
      });

      // TODO: Add medications and notes after patient is created
      toast.success(`Imported ${importData.firstName} ${importData.lastName} from Practice Fusion`);
      setStep('done');
    } catch (err: any) {
      toast.error('Failed to save patient: ' + (err.message || 'Unknown error'));
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setStep('portal');
    setImportData(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5" />
            Import from Practice Fusion
          </DialogTitle>
          <DialogDescription>
            Pull patient data directly from Practice Fusion via FHIR API
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {step === 'portal' && (
            <>
              <div className="space-y-3">
                <label className="text-sm font-medium">Select Patient Portal</label>
                <Select value={portal} onValueChange={(v) => setPortal(v as 'pf' | 'fmh')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pf">Patient Fusion</SelectItem>
                    <SelectItem value="fmh">FollowMyHealth</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                You'll be redirected to sign in with your Practice Fusion patient portal credentials.
                The app will request read-only access to demographics, allergies, medications, conditions, and notes.
              </p>
              <Button className="w-full gap-2" onClick={handleAuthorize}>
                <Download className="w-4 h-4" />
                Connect & Import
              </Button>
            </>
          )}

          {step === 'authorize' && (
            <div className="text-center py-8 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
              <p className="text-sm text-muted-foreground">
                Waiting for Practice Fusion authorization...
              </p>
              <p className="text-xs text-muted-foreground">
                Complete sign-in in the popup window
              </p>
            </div>
          )}

          {step === 'loading' && (
            <div className="text-center py-8 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
              <p className="text-sm text-muted-foreground">
                Fetching patient data from Practice Fusion...
              </p>
            </div>
          )}

          {step === 'preview' && importData && (
            <>
              <Card className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                    {importData.firstName?.[0]}{importData.lastName?.[0]}
                  </div>
                  <div>
                    <p className="font-semibold">{importData.lastName}, {importData.firstName}</p>
                    <p className="text-xs text-muted-foreground">
                      {importData.mrn} · {importData.gender === 'female' ? 'Female' : 'Male'} · DOB: {importData.dob}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
                    <span>{importData.allergies?.length || 0} allergies</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Pill className="w-3.5 h-3.5 text-blue-500" />
                    <span>{importData.medications?.length || 0} medications</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-green-500" />
                    <span>{importData.notes?.length || 0} documents</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-purple-500" />
                    <span>{importData.conditions?.length || 0} conditions</span>
                  </div>
                </div>

                {importData.allergies?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-1">Allergies</p>
                    <div className="flex flex-wrap gap-1">
                      {importData.allergies.map((a: string, i: number) => (
                        <Badge key={i} variant="destructive" className="text-xs">{a}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </Card>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep('portal')}>
                  Cancel
                </Button>
                <Button className="flex-1 gap-2" onClick={handleImport} disabled={importing}>
                  {importing && <Loader2 className="w-4 h-4 animate-spin" />}
                  Import Patient
                </Button>
              </div>
            </>
          )}

          {step === 'done' && (
            <div className="text-center py-8 space-y-3">
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto" />
              <p className="text-sm font-medium">Patient imported successfully!</p>
              <Button variant="outline" onClick={handleClose}>Close</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
