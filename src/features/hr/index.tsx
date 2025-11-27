// src/features/hr/index.tsx
// بسم الله الرحمن الرحيم
// نقطة الدخول الرئيسية لوحدة الموارد البشرية

import React from 'react';
import { RouteObject, Navigate } from 'react-router-dom';
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

// تصدير إعدادات المسارات لجهاز التوجيه الرئيسي
export const hrRoutes: RouteObject = {
  path: 'hr',
  element: <HrDashboardLayout />,
  children: [
    {
      index: true,
      element: <Navigate to="overview" replace />,
    },
    {
      path: 'overview',
      element: <DashboardPage />,
    },
    {
      path: 'employees',
      element: <EmployeeListPage />,
    },
    {
      path: 'employees/:id',
      element: <EmployeeProfilePage />,
    },
    {
      path: 'attendance',
      element: <AttendancePage />,
    },
    {
      path: 'payroll',
      element: <PayrollPage />,
    },
    {
      path: 'leaves',
      element: <LeavesPage />,
    },
    {
      path: 'settlements',
      element: <SettlementsPage />,
    },
    {
      path: 'reports',
      element: <ReportsPage />,
    },
    {
      path: 'settings',
      element: <SettingsPage />,
    },
  ],
};

// تصدير للتوافق مع الإصدارات السابقة
export const HRModule: React.FC = () => {
  return <HrDashboardLayout />;
};
