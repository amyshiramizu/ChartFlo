import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FileText, Users, ClipboardList, Settings, Mic, Send, Menu, X, LogOut, HeartPulse, Activity, CalendarDays, Stethoscope, BookOpen, DollarSign, BarChart3, Database } from 'lucide-react';
import { ClinicSwitcher } from '@/components/ClinicSwitcher';
import { ClinicManageDialog } from '@/components/ClinicManageDialog';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/hooks/useAuth';
import { useClinic } from '@/hooks/useClinic';

const navItems = [
  { path: '/', label: 'Dashboard', icon: Users },
  { path: '/today', label: "Today's Patients", icon: CalendarDays },
  { path: '/chart', label: 'Charts', icon: Stethoscope },
  { path: '/notes', label: 'Notes', icon: FileText },
  { path: '/orders', label: 'Orders', icon: Send },
  { path: '/ccm', label: 'CCM Tracker', icon: HeartPulse },
  { path: '/rpm', label: 'RPM Tracker', icon: Activity },
  { path: '/codes', label: 'Code Lookup', icon: BookOpen },
  { path: '/billing', label: 'Billing', icon: DollarSign },
  { path: '/quality', label: 'Quality', icon: BarChart3 },
  { path: '/database', label: 'Database', icon: Database },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const [showManage, setShowManage] = useState(false);
  const { signOut } = useAuth();
  const {
    clinics, activeClinic, switchClinic, createClinic,
    defaultClinicId, setAsDefaultClinic,
    members, fetchMembers, removeMember, updateMemberRole, deleteClinic,
  } = useClinic();


  return (
    <>
      <div className="flex flex-col h-full">
        <div className="p-5 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <Mic className="w-5 h-5 text-sidebar-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-sidebar-foreground">Chart Flo</h1>
              <p className="text-xs text-sidebar-foreground/60">Medical Dictation</p>
            </div>
          </div>
        </div>

        {/* Clinic Switcher */}
        <div className="px-3 pt-3 pb-1 border-b border-sidebar-border">
          <ClinicSwitcher
            clinics={clinics}
            activeClinic={activeClinic}
            defaultClinicId={defaultClinicId}
            onSwitch={(id) => {
              switchClinic(id);
              window.location.reload(); // Reload to refresh all data for the new clinic
            }}
            onSetDefault={setAsDefaultClinic}
            onCreate={createClinic}
            onManage={() => setShowManage(true)}
          />

        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto min-h-0">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={onNavigate}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border space-y-1">
          <Link
            to="/settings"
            onClick={onNavigate}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
          >
            <Settings className="w-4 h-4" />
            Settings
          </Link>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/60 hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>

      
      <ClinicManageDialog
        open={showManage}
        onOpenChange={setShowManage}
        clinic={activeClinic}
        members={members}
        onFetchMembers={fetchMembers}
        onRemoveMember={removeMember}
        onUpdateRole={updateMemberRole}
        onDeleteClinic={deleteClinic}
      />
    </>
  );
}

export function MobileHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="md:hidden sticky top-0 z-50 flex items-center gap-3 px-4 py-3 bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="text-sidebar-foreground hover:bg-sidebar-accent/50">
            <Menu className="w-5 h-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-64 bg-sidebar text-sidebar-foreground border-sidebar-border">
          <SidebarContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-sidebar-primary flex items-center justify-center">
          <Mic className="w-4 h-4 text-sidebar-primary-foreground" />
        </div>
        <span className="text-sm font-semibold">Chart Flo</span>
      </div>
    </header>
  );
}

export function AppSidebar() {
  const isMobile = useIsMobile();

  if (isMobile) {
    return null;
  }

  return (
    <aside className="hidden md:flex w-64 h-screen sticky top-0 bg-sidebar text-sidebar-foreground flex-col border-r border-sidebar-border">
      <SidebarContent />
    </aside>
  );
}
