import { MobileHeader, AppSidebar } from '@/components/AppSidebar';

export function PageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <MobileHeader />
      <AppSidebar />
      {children}
    </div>
  );
}
