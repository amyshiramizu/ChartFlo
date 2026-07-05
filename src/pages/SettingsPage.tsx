import { PageLayout } from '@/components/MobileLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TemplateManager } from '@/components/TemplateManager';
import { UserSettingsForm } from '@/components/UserSettingsForm';
import { ClinicsManager } from '@/components/ClinicsManager';
import { ClinicSettingsForm } from '@/components/ClinicSettingsForm';
import { RPMDevicesManager } from '@/components/RPMDevicesManager';
import { CarePlanTemplatesManager } from '@/components/CarePlanTemplatesManager';
import { PFExtensionCard } from '@/components/PFExtensionCard';
import { PracticeFusionInfoCard } from '@/components/PracticeFusionInfoCard';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UserCog, Building2, Activity, FileText, ClipboardList, Chrome, Settings as SettingsIcon, FlaskConical, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function SettingsPage() {
  return (
    <PageLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your account, clinics, devices, and clinical templates.</p>
        </div>

        <Tabs defaultValue="account" className="w-full">
          <TabsList className="w-full flex-wrap h-auto">
            <TabsTrigger value="account" className="gap-1.5"><UserCog className="w-3.5 h-3.5" />Account</TabsTrigger>
            <TabsTrigger value="clinics" className="gap-1.5"><Building2 className="w-3.5 h-3.5" />Clinics &amp; Users</TabsTrigger>
            <TabsTrigger value="clinic-settings" className="gap-1.5"><SettingsIcon className="w-3.5 h-3.5" />Clinic Settings</TabsTrigger>
            <TabsTrigger value="devices" className="gap-1.5"><Activity className="w-3.5 h-3.5" />RPM Devices</TabsTrigger>
            <TabsTrigger value="notes" className="gap-1.5"><FileText className="w-3.5 h-3.5" />Note Templates</TabsTrigger>
            <TabsTrigger value="careplans" className="gap-1.5"><ClipboardList className="w-3.5 h-3.5" />Care Plans</TabsTrigger>
            <TabsTrigger value="integrations" className="gap-1.5"><Chrome className="w-3.5 h-3.5" />Integrations</TabsTrigger>
          </TabsList>

          <TabsContent value="account" className="mt-4"><UserSettingsForm /></TabsContent>
          <TabsContent value="clinics" className="mt-4"><ClinicsManager /></TabsContent>
          <TabsContent value="clinic-settings" className="mt-4"><ClinicSettingsForm /></TabsContent>
          <TabsContent value="devices" className="mt-4"><RPMDevicesManager /></TabsContent>
          <TabsContent value="notes" className="mt-4"><TemplateManager /></TabsContent>
          <TabsContent value="careplans" className="mt-4"><CarePlanTemplatesManager /></TabsContent>
          <TabsContent value="integrations" className="mt-4 space-y-4">
            <PFExtensionCard />
            <PracticeFusionInfoCard />
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2.5">
                  <FlaskConical className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground">PF Extension Test</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Simulate a Practice Fusion encounter and verify that medication changes (start, change, stop, continue) format correctly before pushing live.
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <Button asChild variant="outline" className="gap-2">
                  <Link to="/pf-test">
                    Open PF Extension Test
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PageLayout>
  );
}
