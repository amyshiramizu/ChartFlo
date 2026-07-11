import { MobileHeader, AppSidebar } from '@/components/AppSidebar';
import PeriodMetricsBar from '@/components/PeriodMetricsBar';
import CriticalAlertsBanner from '@/components/CriticalAlertsBanner';

export function PageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <MobileHeader />
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <CriticalAlertsBanner />
        <PeriodMetricsBar />
        {children}
      </div>
    </div>
  );
}
