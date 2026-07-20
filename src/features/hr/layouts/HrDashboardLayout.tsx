import React from 'react';
import { PageTransition } from '../components/shared/PageTransition';

interface HrDashboardLayoutProps {
  children: React.ReactNode;
}

export const HrDashboardLayout: React.FC<HrDashboardLayoutProps> = ({ children }) => (
  <div className="h-full overflow-auto p-6">
    <PageTransition>{children}</PageTransition>
  </div>
);
