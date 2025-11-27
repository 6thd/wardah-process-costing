// src/features/hr/layouts/HrDashboardLayout.tsx
// بسم الله الرحمن الرحيم
// تخطيط وحدة الموارد البشرية

import React from 'react';
import { PageTransition } from '../components/shared/PageTransition';

interface HrDashboardLayoutProps {
    children: React.ReactNode;
}

export const HrDashboardLayout: React.FC<HrDashboardLayoutProps> = ({ children }) => {
    return (
        <div className="h-full overflow-auto p-6 bg-slate-50/50">
            <PageTransition>
                {children}
            </PageTransition>
        </div>
    );
};
