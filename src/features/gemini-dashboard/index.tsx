import { Routes, Route, Navigate } from 'react-router-dom'
import { IframeDashboard } from './iframe-dashboard.tsx'

export function GeminiDashboardModule() {
  return (
    <Routes>
      <Route path="/" element={<IframeDashboard />} />
      <Route path="/overview" element={<IframeDashboard />} />
      <Route path="*" element={<Navigate to="/gemini-dashboard/overview" replace />} />
    </Routes>
  )
}