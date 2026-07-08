import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePatientStore } from '@/store/patientStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserCog, Copy, Save } from 'lucide-react';
import { toast } from 'sonner';

export function UserSettingsForm() {
  const { user } = useAuth();
  const { templates } = usePatientStore();
  const [defaultProgram, setDefaultProgram] = useState('CCM');
  const [defaultTemplateId, setDefaultTemplateId] = useState<string>('');
  
  const [defaultLocation, setDefaultLocation] = useState('');
  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: settings }, { data: profile }] = await Promise.all([
        supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('profiles').select('full_name, title').eq('user_id', user.id).maybeSingle(),
      ]);
      if (settings) {
        setDefaultProgram(settings.default_program || 'CCM');
        setDefaultTemplateId(settings.default_template_id || '');
        
        setDefaultLocation(settings.default_location || '');
      }
      if (profile) {
        setFullName(profile.full_name || '');
        setTitle(profile.title || '');
      }
    })();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const [settingsRes, profileRes] = await Promise.all([
      supabase.from('user_settings').upsert({
        user_id: user.id,
        default_program: defaultProgram,
        default_template_id: defaultTemplateId || null,
        default_location: defaultLocation,
      }),
      supabase.from('profiles').upsert({
        user_id: user.id,
        email: user.email || '',
        full_name: fullName,
        title,
      }, { onConflict: 'user_id' }),
    ]);
    setSaving(false);
    if (settingsRes.error) return toast.error(settingsRes.error.message);
    if (profileRes.error) return toast.error(profileRes.error.message);
    toast.success('Settings saved');
  };


  const copyUserId = () => {
    if (!user) return;
    navigator.clipboard.writeText(user.id);
    toast.success('User ID copied — share with a clinic admin to be invited');
  };

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-center gap-2">
        <UserCog className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">My Account &amp; Preferences</h2>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Email</Label>
        <Input value={user?.email || ''} disabled />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Full Name</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g., Jane Smith" />
        </div>
        <div>
          <Label className="text-xs">Title / Role</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., MD, NP, RN, MA" />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">User ID</Label>
        <div className="flex gap-2">
          <Input value={user?.id || ''} disabled className="font-mono text-xs" />
          <Button variant="outline" onClick={copyUserId} className="gap-1.5">
            <Copy className="w-3.5 h-3.5" /> Copy
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Clinic admins can now also invite you by email — sharing the User ID is optional.</p>
      </div>


      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Default Program</Label>
          <Select value={defaultProgram} onValueChange={setDefaultProgram}>
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
          <Label className="text-xs">Default Note Template</Label>
          <Select value={defaultTemplateId} onValueChange={setDefaultTemplateId}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="text-xs">Default Location</Label>
        <Input value={defaultLocation} onChange={(e) => setDefaultLocation(e.target.value)} placeholder="e.g., Main Clinic" />
      </div>


      <Button onClick={handleSave} disabled={saving} className="gap-2">
        <Save className="w-4 h-4" /> Save Settings
      </Button>
    </Card>
  );
}
