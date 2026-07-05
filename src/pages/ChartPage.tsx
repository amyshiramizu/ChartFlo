import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageLayout } from '@/components/MobileLayout';
import { PatientChart } from '@/components/PatientChart';
import { usePatientStore } from '@/store/patientStore';

export default function ChartPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedPatientId, selectPatient, patients, fetchPatients } = usePatientStore();

  useEffect(() => {
    if (patients.length === 0) fetchPatients();
  }, [patients.length, fetchPatients]);

  useEffect(() => {
    if (id && id !== selectedPatientId) {
      selectPatient(id);
    }
  }, [id, selectedPatientId, selectPatient]);

  useEffect(() => {
    // No id in URL and no selected patient — bounce to dashboard to pick one
    if (!id && !selectedPatientId) {
      navigate('/', { replace: true });
    }
  }, [id, selectedPatientId, navigate]);

  return (
    <PageLayout>
      <PatientChart />
    </PageLayout>
  );
}
