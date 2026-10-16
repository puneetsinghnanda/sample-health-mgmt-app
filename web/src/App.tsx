import { Route, Routes } from 'react-router-dom';
import { api } from './api/client';
import { Layout } from './components/Layout';
import { useAsync } from './hooks/useAsync';
import { SettingsProvider } from './hooks/useSettings';
import { AppointmentDetailPage } from './pages/AppointmentDetailPage';
import { AppointmentsPage } from './pages/AppointmentsPage';
import { BookAppointmentPage } from './pages/BookAppointmentPage';
import { DashboardPage } from './pages/DashboardPage';
import { DoctorDetailPage } from './pages/DoctorDetailPage';
import { DoctorFormPage } from './pages/DoctorFormPage';
import { DoctorsPage } from './pages/DoctorsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PatientDetailPage } from './pages/PatientDetailPage';
import { PatientFormPage } from './pages/PatientFormPage';
import { PatientsPage } from './pages/PatientsPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const settings = useAsync(() => api.settings(), 'settings');
  return (
    <SettingsProvider value={settings.data}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/doctors" element={<DoctorsPage />} />
          <Route path="/doctors/new" element={<DoctorFormPage />} />
          <Route path="/doctors/:id" element={<DoctorDetailPage />} />
          <Route path="/doctors/:id/edit" element={<DoctorFormPage />} />
          <Route path="/patients" element={<PatientsPage />} />
          <Route path="/patients/new" element={<PatientFormPage />} />
          <Route path="/patients/:id" element={<PatientDetailPage />} />
          <Route path="/patients/:id/edit" element={<PatientFormPage />} />
          <Route path="/appointments" element={<AppointmentsPage />} />
          <Route path="/appointments/new" element={<BookAppointmentPage />} />
          <Route path="/appointments/:id" element={<AppointmentDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </SettingsProvider>
  );
}
