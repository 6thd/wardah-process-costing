// src/features/hr/layouts/HrDashboardLayout.tsx
// بسم الله الرحمن الرحيم
// تخطيط وحدة الموارد البشرية

import React from 'react';
import { PageTransition } from '../components/shared/PageTransition';
import { HrLegacyLocalization } from '../components/HrLegacyLocalization';

interface HrDashboardLayoutProps {
    children: React.ReactNode;
}

export const HrDashboardLayout: React.FC<HrDashboardLayoutProps> = ({ children }) => {
    const rootRef = React.useRef<HTMLDivElement>(null);

    return (
        <div ref={rootRef} data-hr-localization className="h-full overflow-auto p-6">
            <HrLegacyLocalization rootRef={rootRef} />
            <PageTransition>
                {children}
            </PageTransition>
        </div>
    );
};
