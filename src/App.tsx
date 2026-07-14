import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useClinicBranding } from "@/hooks/useClinicBranding";
import Index from "./pages/Index.tsx";
import NotesPage from "./pages/NotesPage.tsx";
import OrdersPage from "./pages/OrdersPage.tsx";
import SettingsPage from "./pages/SettingsPage.tsx";
import AuthPage from "./pages/AuthPage.tsx";
import PFCallbackPage from "./pages/PFCallbackPage.tsx";
import CCMDashboardPage from "./pages/CCMDashboardPage.tsx";
import RPMDashboardPage from "./pages/RPMDashboardPage.tsx";
import CCMPatientChartPage from "./pages/CCMPatientChartPage.tsx";
import TodayPage from "./pages/TodayPage.tsx";
import ChartPage from "./pages/ChartPage.tsx";
import CodeLookupPage from "./pages/CodeLookupPage.tsx";
import BillingPage from "./pages/BillingPage.tsx";
import QualityPage from "./pages/QualityPage.tsx";
import MonthSignOffPage from "./pages/MonthSignOffPage.tsx";
import PFExtensionTestPage from "./pages/PFExtensionTestPage.tsx";


import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  useClinicBranding();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}

// The tabbed CCM chart is the one patient chart; old profile links land there.
function PatientChartRedirect() {
  const { id } = useParams();
  return <Navigate to={`/ccm/patient/${id}`} replace />;
}

const AppRoutes = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/auth" element={user ? <Navigate to="/" replace /> : <AuthPage />} />
      <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
      <Route path="/notes" element={<ProtectedRoute><NotesPage /></ProtectedRoute>} />
      <Route path="/orders" element={<ProtectedRoute><OrdersPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/clinic-settings" element={<Navigate to="/settings" replace />} />
      <Route path="/templates" element={<Navigate to="/settings" replace />} />
      <Route path="/patient/:id" element={<ProtectedRoute><PatientChartRedirect /></ProtectedRoute>} />
      <Route path="/ccm" element={<ProtectedRoute><CCMDashboardPage /></ProtectedRoute>} />
      <Route path="/today" element={<ProtectedRoute><TodayPage /></ProtectedRoute>} />
      <Route path="/chart" element={<ProtectedRoute><ChartPage /></ProtectedRoute>} />
      <Route path="/chart/:id" element={<ProtectedRoute><ChartPage /></ProtectedRoute>} />
      <Route path="/ccm/patient/:id" element={<ProtectedRoute><CCMPatientChartPage /></ProtectedRoute>} />
      <Route path="/rpm" element={<ProtectedRoute><RPMDashboardPage /></ProtectedRoute>} />
      <Route path="/codes" element={<ProtectedRoute><CodeLookupPage /></ProtectedRoute>} />
      <Route path="/billing" element={<ProtectedRoute><BillingPage /></ProtectedRoute>} />
      <Route path="/quality" element={<ProtectedRoute><QualityPage /></ProtectedRoute>} />
      <Route path="/database" element={<Navigate to="/" replace />} />
      <Route path="/signoff" element={<ProtectedRoute><MonthSignOffPage /></ProtectedRoute>} />
      <Route path="/pf-test" element={<ProtectedRoute><PFExtensionTestPage /></ProtectedRoute>} />
      <Route path="/pf-callback" element={<PFCallbackPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
