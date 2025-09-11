import { Routes, Route, Navigate } from 'react-router-dom'
import { DashboardOverview } from './dashboard-overview.tsx'

export function DashboardModule() {
  return (
    <Routes>
      <Route path="/" element={<DashboardOverview />} />
      <Route path="/overview" element={<DashboardOverview />} />
      <Route path="*" element={<Navigate to="/dashboard/overview" replace />} />
    </Routes>
  )
}