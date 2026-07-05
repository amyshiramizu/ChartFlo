import { PageLayout } from '@/components/MobileLayout';
import { PatientDashboard } from '@/components/PatientDashboard';
import { useAutoPFPushScheduler } from '@/hooks/useAutoPFPushScheduler';

const Index = () => {
  useAutoPFPushScheduler();
  return (
    <PageLayout>
      <PatientDashboard />
    </PageLayout>
  );
};

export default Index;
