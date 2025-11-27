// src/features/hr/layouts/HrDashboardLayout.tsx
// بسم الله الرحمن الرحيم
// تخطيط وحدة الموارد البشرية - بدون شريط جانبي داخلي

import React from 'react';
import { Outlet } from 'react-router-dom';
import { PageTransition } from '../components/shared/PageTransition';

export const HrDashboardLayout: React.FC = () => {
    return (
        <div className="h-full overflow-auto p-6 bg-slate-50/50">
            <PageTransition>
                <Outlet />
            </PageTransition>
        </div>
    );
};
