import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import RequireAuth from './components/layout/RequireAuth';
import AuthPage from './pages/AuthPage';
import BuildPage from './pages/BuildPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import GitHubIntegrationPage from './pages/GitHubIntegrationPage';
import LandingPage from './pages/LandingPage';
import NewProjectPage from './pages/NewProjectPage';
import ProjectPage from './pages/ProjectPage';
import ProjectsPage from './pages/ProjectsPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import SettingsPage from './pages/SettingsPage';
import VerifyEmailPage from './pages/VerifyEmailPage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<LandingPage />} />
        <Route element={<RequireAuth />}>
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/new" element={<NewProjectPage />} />
          <Route path="projects/:projectId" element={<ProjectPage />} />
          <Route path="projects/:projectId/builds/:number" element={<BuildPage />} />
          <Route path="integrations/github" element={<GitHubIntegrationPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="auth" element={<AuthPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="verify-email" element={<VerifyEmailPage />} />
        {/* Old prototype screens, replaced by the project and build pages. */}
        <Route path="dashboard" element={<Navigate to="/projects" replace />} />
        <Route path="job" element={<Navigate to="/projects" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
