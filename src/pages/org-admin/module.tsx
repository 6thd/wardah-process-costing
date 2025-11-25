// src/pages/org-admin/module.tsx
// بسم الله الرحمن الرحيم
// Org Admin Module Router

import { Routes, Route, Navigate } from 'react-router-dom';
import OrgAdminLayout from './index';
import OrgAdminDashboard from './dashboard';
import OrgAdminUsers from './users';
import OrgAdminInvitations from './invitations';
import OrgAdminRoles from './roles';
import OrgAdminAuditLog from './audit-log';

export function OrgAdminModule() {
  return (
    <Routes>
      <Route element={<OrgAdminLayout />}>
        <Route index element={<OrgAdminDashboard />} />
        <Route path="dashboard" element={<OrgAdminDashboard />} />
        <Route path="users" element={<OrgAdminUsers />} />
        <Route path="invitations" element={<OrgAdminInvitations />} />
        <Route path="roles" element={<OrgAdminRoles />} />
        <Route path="audit-log" element={<OrgAdminAuditLog />} />
        <Route path="*" element={<Navigate to="/org-admin" replace />} />
      </Route>
    </Routes>
  );
}

export default OrgAdminModule;

