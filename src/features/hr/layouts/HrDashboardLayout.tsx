import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    LayoutDashboard,
    Users,
    CalendarDays,
    Banknote,
    Palmtree,
    Settings,
    Briefcase,
    BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PageTransition } from '../components/shared/PageTransition';

interface SidebarItemProps {
    icon: React.ElementType;
    label: string;
    path: string;
    isActive: boolean;
    onClick: () => void;
}

const SidebarItem: React.FC<SidebarItemProps> = ({
    icon: Icon,
    label,
    path,
    isActive,
    onClick,
}) => (
    <Button
        variant={isActive ? 'secondary' : 'ghost'}
        className={cn(
            'w-full justify-start gap-3',
            isActive && 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
        )}
        onClick={onClick}
    >
        <Icon className="h-4 w-4" />
        {label}
    </Button>
);

export const HrDashboardLayout: React.FC = () => {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();

    const navItems = [
        { label: 'لوحة التحكم', icon: LayoutDashboard, path: '/hr' },
        { label: 'الموظفون', icon: Users, path: '/hr/employees' },
        { label: 'الحضور', icon: CalendarDays, path: '/hr/attendance' },
        { label: 'الرواتب', icon: Banknote, path: '/hr/payroll' },
        { label: 'الإجازات', icon: Palmtree, path: '/hr/leaves' },
        { label: 'التسويات', icon: Briefcase, path: '/hr/settlements' },
        { label: 'التقارير', icon: BarChart3, path: '/hr/reports' },
        { label: t('hr.settings'), icon: Settings, path: '/hr/settings' },
    ];

    return (
        <div className="flex h-[calc(100vh-4rem)]">
            {/* Sidebar */}
            <aside className="w-64 border-l bg-card hidden md:block">
                <div className="p-4">
                    <h2 className="text-lg font-semibold text-emerald-700 mb-1">الموارد البشرية</h2>
                    <p className="text-xs text-muted-foreground">نظام إدارة متكامل</p>
                </div>
                <ScrollArea className="h-[calc(100%-5rem)] px-2">
                    <div className="space-y-1">
                        {navItems.map((item) => (
                            <SidebarItem
                                key={item.path}
                                icon={item.icon}
                                label={item.label}
                                path={item.path}
                                isActive={location.pathname === item.path || (item.path !== '/hr' && location.pathname.startsWith(item.path))}
                                onClick={() => navigate(item.path)}
                            />
                        ))}
                    </div>
                </ScrollArea>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-hidden bg-slate-50/50">
                <ScrollArea className="h-full p-6">
                    <PageTransition>
                        <Outlet />
                    </PageTransition>
                </ScrollArea>
            </main>
        </div>
    );
};
