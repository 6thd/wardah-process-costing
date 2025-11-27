// src/features/hr/index.tsx
// بسم الله الرحمن الرحيم
// نقطة الدخول الرئيسية لوحدة الموارد البشرية

import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { HrDashboardLayout } from './layouts/HrDashboardLayout';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeeListPage } from './pages/EmployeeListPage';
import { EmployeeProfilePage } from './pages/EmployeeProfilePage';
import { PayrollPage } from './pages/PayrollPage';
import { AttendancePage } from './pages/AttendancePage';
import { LeavesPage } from './pages/LeavesPage';
import { SettlementsPage } from './pages/SettlementsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';

// المكون الرئيسي لوحدة الموارد البشرية
export const HRModule: React.FC = () => {
  return (
    <HrDashboardLayout>
      <Routes>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<DashboardPage />} />
        <Route path="employees" element={<EmployeeListPage />} />
        <Route path="employees/:id" element={<EmployeeProfilePage />} />
        <Route path="attendance" element={<AttendancePage />} />
        <Route path="payroll" element={<PayrollPage />} />
        <Route path="leaves" element={<LeavesPage />} />
        <Route path="settlements" element={<SettlementsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        {/* مسار افتراضي للصفحات غير الموجودة */}
        <Route path="*" element={<Navigate to="overview" replace />} />
      </Routes>
    </HrDashboardLayout>
  );
};
