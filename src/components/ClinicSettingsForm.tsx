import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useClinic } from '@/hooks/useClinic';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Save, Lock, Upload, ImageOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { uploadLogoFile } from '@/lib/logoStorage';
import { BrandingPreview } from '@/components/BrandingPreview';
import { resolveClinicLogoUrl } from '@/lib/clinicLogoUrl';



interface ClinicSettings {
  default_program: string;
  default_location: string;
  brand_name: string;
  brand_phone: string;
  brand_fax: string;
  brand_address: string;
  signature_block: string;
  logo_url: string;
  favicon_url: string;
  auto_pf_push_enabled: boolean;
  auto_pf_push_time: string;
}

const EMPTY: ClinicSettings = {
  default_program: 'CCM',
  default_location: '',
  brand_name: '',
  brand_phone: '',
  brand_fax: '',
  brand_address: '',
  signature_block: '',
  logo_url: '',
  favicon_url: '',
  auto_pf_push_enabled: false,
  auto_pf_push_time: '18:00',
};

export function ClinicSettingsForm() {
  const { activeClinic } = useClinic();
  const [settings, setSettings] = useState<ClinicSettings>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  const [previewLogoUrl, setPreviewLogoUrl] = useState<string>('');
  const [previewFaviconUrl, setPreviewFaviconUrl] = useState<string>('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const faviconRef = useRef<HTMLInputElement | null>(null);


  const isAdmin = activeClinic?.role === 'admin';
  const canEdit = !!activeClinic && isAdmin;

  useEffect(() => {
    if (!activeClinic) {
      setSettings(EMPTY);
      return;
    }
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('clinic_settings')
        .select('*')
        .eq('clinic_id', activeClinic.id)
        .maybeSingle();
      if (!error && data) {
        setSettings({
          default_program: data.default_program || 'CCM',
          default_location: data.default_location || '',
          brand_name: data.brand_name || '',
          brand_phone: data.brand_phone || '',
          brand_fax: data.brand_fax || '',
          brand_address: data.brand_address || '',
          signature_block: data.signature_block || '',
          logo_url: data.logo_url || '',
          favicon_url: (data as any).favicon_url || '',
          auto_pf_push_enabled: !!(data as any).auto_pf_push_enabled,
          auto_pf_push_time: (data as any).auto_pf_push_time || '18:00',
        });
      } else {
        setSettings({ ...EMPTY, brand_name: activeClinic.name });
      }
      setLoading(false);
    })();
  }, [activeClinic]);

  // Generate signed preview URLs whenever the stored value changes
  useEffect(() => {
    let cancelled = false;
    resolveClinicLogoUrl(settings.logo_url).then((url) => {
      if (!cancelled) setPreviewLogoUrl(url || '');
    });
    return () => { cancelled = true; };
  }, [settings.logo_url]);

  useEffect(() => {
    let cancelled = false;
    resolveClinicLogoUrl(settings.favicon_url).then((url) => {
      if (!cancelled) setPreviewFaviconUrl(url || '');
    });
    return () => { cancelled = true; };
  }, [settings.favicon_url]);


  const update = (patch: Partial<ClinicSettings>) =>
    setSettings((s) => ({ ...s, ...patch }));

  const handleSave = async () => {
    if (!activeClinic) return;
    setSaving(true);
    const { error } = await supabase
      .from('clinic_settings')
      .upsert(
        { clinic_id: activeClinic.id, ...settings },
        { onConflict: 'clinic_id' },
      );
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Clinic settings saved');
  };

  const handleLogoUpload = async (file: File) => {
    if (!activeClinic) return;
    if (!file.type.startsWith('image/')) {
      return toast.error('Please choose an image file (PNG, JPG, SVG, WebP).');
    }
    if (file.size > 2 * 1024 * 1024) {
      return toast.error('Logo must be 2 MB or smaller.');
    }
    setUploading(true);
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${activeClinic.id}/logo-${Date.now()}.${ext}`;
    const { error: upErr } = await uploadLogoFile(path, file);
    if (upErr) {
      setUploading(false);
      return toast.error(upErr);
    }
    // Store path only — bucket is private, signed URLs are generated at render time.
    update({ logo_url: path });

    setUploading(false);
    toast.success('Logo uploaded — remember to Save Clinic Settings.');
  };

  const handleLogoClear = () => update({ logo_url: '' });

  const handleFaviconUpload = async (file: File) => {
    if (!activeClinic) return;
    const ok = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml', 'image/jpeg', 'image/webp'];
    if (!ok.includes(file.type) && !file.name.match(/\.(png|ico|svg|jpg|jpeg|webp)$/i)) {
      return toast.error('Favicon must be PNG, ICO, SVG, JPG, or WebP.');
    }
    if (file.size > 512 * 1024) {
      return toast.error('Favicon must be 512 KB or smaller.');
    }
    setUploadingFavicon(true);
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${activeClinic.id}/favicon-${Date.now()}.${ext}`;
    const { error: upErr } = await uploadLogoFile(path, file);
    if (upErr) {
      setUploadingFavicon(false);
      return toast.error(upErr);
    }
    update({ favicon_url: path });

    setUploadingFavicon(false);
    toast.success('Favicon uploaded — remember to Save Clinic Settings.');
  };

  const handleFaviconClear = () => update({ favicon_url: '' });

  if (!activeClinic) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Clinic Settings</h2>
        </div>
        <p className="text-sm text-muted-foreground italic">
          Select or create a clinic to configure clinic-wide settings.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Clinic Settings</h2>
        </div>
        <span className="text-xs text-muted-foreground truncate">
          {activeClinic.name}
        </span>
      </div>

      {!isAdmin && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/40 border border-border text-xs text-muted-foreground">
          <Lock className="w-3.5 h-3.5" />
          Only clinic admins can edit these settings. You are viewing them in read-only mode.
        </div>
      )}

      <fieldset disabled={!canEdit || loading} className="space-y-5 disabled:opacity-80">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Default Program</Label>
            <Select
              value={settings.default_program}
              onValueChange={(v) => update({ default_program: v })}
              disabled={!canEdit}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CCM">CCM</SelectItem>
                <SelectItem value="RPM">RPM</SelectItem>
                <SelectItem value="BHI">BHI</SelectItem>
                <SelectItem value="CCO">CCO</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Default Location</Label>
            <Input
              value={settings.default_location}
              onChange={(e) => update({ default_location: e.target.value })}
              placeholder="e.g., Main Clinic"
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4 bg-muted/20">
          <h3 className="text-sm font-semibold text-primary">Branding (used on orders &amp; faxes)</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Brand / Practice Name</Label>
              <Input
                value={settings.brand_name}
                onChange={(e) => update({ brand_name: e.target.value })}
                placeholder="e.g., Home Medical Services"
              />
            </div>
            <div>
              <Label className="text-xs">Clinic Logo</Label>
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-md border border-border bg-background flex items-center justify-center overflow-hidden shrink-0">
                  {settings.logo_url && previewLogoUrl ? (
                    <img
                      src={previewLogoUrl}
                      alt="Clinic logo"
                      className="max-h-full max-w-full object-contain"
                      onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                    />
                  ) : (
                    <ImageOff className="w-5 h-5 text-muted-foreground" />
                  )}

                </div>
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="flex gap-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleLogoUpload(f);
                        e.target.value = '';
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!canEdit || uploading}
                      onClick={() => fileRef.current?.click()}
                      className="gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {uploading ? 'Uploading…' : 'Upload'}
                    </Button>
                    {settings.logo_url && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!canEdit}
                        onClick={handleLogoClear}
                        className="gap-1.5 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove
                      </Button>
                    )}
                  </div>
                  <Input
                    value={settings.logo_url}
                    onChange={(e) => update({ logo_url: e.target.value })}
                    placeholder="Or paste a logo URL"
                    className="text-xs h-8"
                  />
                </div>
              </div>
            </div>
            <div>
              <Label className="text-xs">Browser Favicon</Label>
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-md border border-border bg-background flex items-center justify-center overflow-hidden shrink-0">
                  {settings.favicon_url && previewFaviconUrl ? (
                    <img
                      src={previewFaviconUrl}
                      alt="Clinic favicon"
                      className="max-h-full max-w-full object-contain"
                      onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                    />
                  ) : (
                    <ImageOff className="w-5 h-5 text-muted-foreground" />
                  )}

                </div>
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="flex gap-2">
                    <input
                      ref={faviconRef}
                      type="file"
                      accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml,image/jpeg,image/webp,.ico"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFaviconUpload(f);
                        e.target.value = '';
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!canEdit || uploadingFavicon}
                      onClick={() => faviconRef.current?.click()}
                      className="gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {uploadingFavicon ? 'Uploading…' : 'Upload'}
                    </Button>
                    {settings.favicon_url && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!canEdit}
                        onClick={handleFaviconClear}
                        className="gap-1.5 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove
                      </Button>
                    )}
                  </div>
                  <Input
                    value={settings.favicon_url}
                    onChange={(e) => update({ favicon_url: e.target.value })}
                    placeholder="Or paste a favicon URL (PNG / ICO / SVG)"
                    className="text-xs h-8"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Square image, 32×32 or larger. Replaces the browser tab icon for this clinic.
                  </p>
                </div>
              </div>
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input
                value={settings.brand_phone}
                onChange={(e) => update({ brand_phone: e.target.value })}
                placeholder="(555) 555-0100"
              />
            </div>
            <div>
              <Label className="text-xs">Fax</Label>
              <Input
                value={settings.brand_fax}
                onChange={(e) => update({ brand_fax: e.target.value })}
                placeholder="(555) 555-0101"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Address</Label>
              <Input
                value={settings.brand_address}
                onChange={(e) => update({ brand_address: e.target.value })}
                placeholder="123 Main St, Suite 200, City, ST 00000"
              />
            </div>
          </div>
        </div>

        <div>
          <Label className="text-xs">Clinic Signature Block</Label>
          <Textarea
            value={settings.signature_block}
            onChange={(e) => update({ signature_block: e.target.value })}
            placeholder="Default signature appended to clinic-wide documents"
            className="min-h-[80px]"
          />
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4 bg-muted/20">
          <h3 className="text-sm font-semibold text-primary">End-of-Day Practice Fusion Auto-Push</h3>
          <p className="text-xs text-muted-foreground">
            At the configured time, all patients documented today (CCM time or note) are queued
            into Practice Fusion. The Chrome extension fills the CCM encounter when you open PF.
          </p>
          <div className="grid sm:grid-cols-2 gap-3 items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.auto_pf_push_enabled}
                onChange={(e) => update({ auto_pf_push_enabled: e.target.checked })}
                className="h-4 w-4 accent-primary"
              />
              Enable auto-push
            </label>
            <div>
              <Label className="text-xs">Push time (local)</Label>
              <Input
                type="time"
                value={settings.auto_pf_push_time}
                onChange={(e) => update({ auto_pf_push_time: e.target.value })}
              />
            </div>
          </div>
        </div>

        <BrandingPreview
          brandName={settings.brand_name || activeClinic.name}
          logoUrl={previewLogoUrl || settings.logo_url}
          phone={settings.brand_phone}
          fax={settings.brand_fax}
          address={settings.brand_address}
          signatureBlock={settings.signature_block}
        />


        {canEdit && (
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save Clinic Settings'}
          </Button>
        )}
      </fieldset>
    </Card>
  );
}
