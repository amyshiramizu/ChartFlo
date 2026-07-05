import { useEffect, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, UserPlus, Shield, User, Mail, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Clinic, ClinicMember } from '@/hooks/useClinic';

interface ClinicManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clinic: Clinic | null;
  members: ClinicMember[];
  onFetchMembers: (clinicId: string) => void;
  onRemoveMember: (memberId: string) => Promise<{ error: string | null }>;
  onUpdateRole: (memberId: string, role: string) => Promise<{ error: string | null }>;
  onDeleteClinic: (clinicId: string) => Promise<{ error: string | null }>;
}

type MemberStatus = {
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  invited_at: string | null;
  created_at: string | null;
};

export function ClinicManageDialog({
  open, onOpenChange, clinic, members, onFetchMembers,
  onRemoveMember, onUpdateRole, onDeleteClinic,
}: ClinicManageDialogProps) {
  const { user } = useAuth();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, { full_name: string; email: string; title: string }>>({});
  const [statuses, setStatuses] = useState<Record<string, MemberStatus>>({});

  useEffect(() => {
    if (open && clinic) onFetchMembers(clinic.id);
  }, [open, clinic, onFetchMembers]);

  const fetchStatuses = useCallback(async () => {
    if (!clinic) return;
    const { data } = await supabase.functions.invoke('clinic-member-statuses', {
      body: { clinic_id: clinic.id },
    });
    if (data?.statuses) setStatuses(data.statuses);
  }, [clinic]);

  useEffect(() => {
    if (!members.length) { setMemberProfiles({}); return; }
    const ids = members.map((m) => m.user_id);
    supabase.from('profiles').select('user_id, full_name, email, title').in('user_id', ids)
      .then(({ data }) => {
        const map: Record<string, { full_name: string; email: string; title: string }> = {};
        (data || []).forEach((p: any) => { map[p.user_id] = { full_name: p.full_name, email: p.email, title: p.title }; });
        setMemberProfiles(map);
      });
    fetchStatuses();
  }, [members, fetchStatuses]);

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !clinic) return;
    setInviting(true);
    const { data, error } = await supabase.functions.invoke('invite-clinic-member', {
      body: { email: inviteEmail.trim(), clinic_id: clinic.id, role: inviteRole },
    });
    if (error || data?.error) {
      toast.error(data?.error || error?.message || 'Failed to add member');
    } else {
      toast.success(data?.invited ? 'Invitation email sent' : 'Member added');
      setInviteEmail('');
      onFetchMembers(clinic.id);
      setTimeout(fetchStatuses, 500);
    }
    setInviting(false);
  };

  const handleRemove = async (memberId: string) => {
    const { error } = await onRemoveMember(memberId);
    if (error) toast.error(error); else toast.success('Member removed');
  };

  const handleRoleChange = async (memberId: string, newRole: string) => {
    const { error } = await onUpdateRole(memberId, newRole);
    if (error) toast.error(error); else toast.success('Role updated');
  };

  const handleResend = async (memberId: string) => {
    setResendingId(memberId);
    const { data, error } = await supabase.functions.invoke('resend-clinic-invite', {
      body: { member_id: memberId },
    });
    if (error || data?.error) {
      toast.error(data?.error || error?.message || 'Failed to resend');
    } else {
      toast.success(data?.mode === 'recovery'
        ? `Password reset email sent to ${data.email}`
        : `Invitation re-sent to ${data?.email || 'user'}`);
    }
    setResendingId(null);
  };

  const handleDelete = async () => {
    if (!clinic) return;
    if (!window.confirm(`Delete "${clinic.name}"? This cannot be undone. All patient associations will be removed.`)) return;
    const { error } = await onDeleteClinic(clinic.id);
    if (error) toast.error(error);
    else { toast.success('Clinic deleted'); onOpenChange(false); }
  };

  if (!clinic) return null;

  const renderMemberRow = (m: ClinicMember, pending: boolean) => {
    const p = memberProfiles[m.user_id];
    const displayName = m.user_id === user?.id
      ? `You${p?.full_name ? ` (${p.full_name})` : ''}`
      : p?.full_name || p?.email || m.user_id.slice(0, 8) + '…';
    return (
      <div key={m.id} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-muted/30">
        {m.role === 'admin' ? (
          <Shield className="w-4 h-4 text-primary shrink-0" />
        ) : (
          <User className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate">{displayName}</div>
          {p?.email && (
            <div className="text-xs text-muted-foreground truncate">
              {p.email}{p.title ? ` · ${p.title}` : ''}
            </div>
          )}
        </div>
        <Badge variant={m.role === 'admin' ? 'default' : 'secondary'} className="text-xs">{m.role}</Badge>
        {m.user_id !== user?.id && (
          <>
            {pending && (
              <Button
                variant="outline" size="sm"
                className="h-7 gap-1 text-xs"
                disabled={resendingId === m.id}
                onClick={() => handleResend(m.id)}
              >
                <Mail className="w-3 h-3" />
                {resendingId === m.id ? 'Sending…' : 'Resend'}
              </Button>
            )}
            <Select value={m.role} onValueChange={(v) => handleRoleChange(m.id, v)}>
              <SelectTrigger className="w-24 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-destructive hover:bg-destructive/10"
              onClick={() => handleRemove(m.id)}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </>
        )}
        {m.user_id === user?.id && pending && (
          <Button
            variant="outline" size="sm" className="h-7 gap-1 text-xs"
            disabled={resendingId === m.id}
            onClick={() => handleResend(m.id)}
          >
            <Mail className="w-3 h-3" />
            {resendingId === m.id ? 'Sending…' : 'Resend'}
          </Button>
        )}
      </div>
    );
  };

  const pending = members.filter((m) => {
    const s = statuses[m.user_id];
    // Pending = no email confirmation and never signed in
    return s && !s.email_confirmed_at && !s.last_sign_in_at;
  });
  const active = members.filter((m) => !pending.find((p) => p.id === m.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Clinic: {clinic.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Active members */}
          <div>
            <Label className="text-sm font-medium mb-2 block">
              Active Members ({active.length})
            </Label>
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {active.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No active members yet</p>
              ) : active.map((m) => renderMemberRow(m, false))}
            </div>
          </div>

          {/* Pending invitations */}
          {pending.length > 0 && (
            <div>
              <Label className="text-sm font-medium mb-2 flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-amber-600" />
                Pending Invitations ({pending.length})
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                These users have been invited but haven't confirmed their email or signed in yet.
              </p>
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {pending.map((m) => renderMemberRow(m, true))}
              </div>
            </div>
          )}

          {/* Invite */}
          <div className="border-t border-border pt-4">
            <Label className="text-sm font-medium mb-2 block">Invite Member by Email</Label>
            <p className="text-xs text-muted-foreground mb-2">
              If they don't have a Chart Flo account yet, we'll create one and email them a sign-in invitation.
            </p>
            <div className="flex gap-2">
              <Input
                type="email" value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@clinic.com" className="flex-1"
              />
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleInvite} disabled={inviting} size="sm">
                <UserPlus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Delete clinic */}
          <div className="border-t border-destructive/20 pt-4">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              <p className="text-sm font-medium text-destructive">Delete this clinic</p>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Permanently removes the clinic, its members, and unlinks all patients associated with it. This action cannot be undone.
            </p>
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              Delete Clinic
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
