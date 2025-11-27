import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, User, Briefcase, Banknote, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { getEmployees } from '@/services/hr/hr-service';
import { STATUS_BADGES } from '../types';

export const EmployeeProfilePage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    // In a real app, we would have a specific getEmployeeById query
    // For now, we'll reuse getEmployees and find the employee
    const { data: employees = [] } = useQuery({
        queryKey: ['hr', 'employees'],
        queryFn: getEmployees,
        staleTime: 60_000,
    });

    const employee = React.useMemo(() => employees.find((e) => e.id === id), [employees, id]);

    if (!employee) {
        return (
            <div className="flex flex-col items-center justify-center h-96">
                <p className="text-muted-foreground">الموظف غير موجود</p>
                <Button variant="link" onClick={() => navigate('/hr/employees')}>
                    العودة للقائمة
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate('/hr/employees')}>
                    <ArrowRight className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{employee.name}</h1>
                    <p className="text-muted-foreground text-sm">{employee.jobTitle} • {employee.department}</p>
                </div>
                <div className="mr-auto">
                    <Badge className={STATUS_BADGES[employee.status]}>
                        {employee.status}
                    </Badge>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Sidebar Info */}
                <Card className="md:col-span-1 border-border/60 h-fit">
                    <CardContent className="pt-6 flex flex-col items-center text-center">
                        <Avatar className="h-24 w-24 mb-4">
                            <AvatarImage src={`https://ui-avatars.com/api/?name=${employee.name}&background=random`} />
                            <AvatarFallback><User className="h-10 w-10" /></AvatarFallback>
                        </Avatar>
                        <h2 className="text-xl font-semibold">{employee.name}</h2>
                        <p className="text-sm text-muted-foreground mb-4">{employee.code}</p>

                        <div className="w-full space-y-3 text-right mt-4 border-t pt-4">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">تاريخ التعيين</span>
                                <span>{employee.hiringDate ? new Date(employee.hiringDate).toLocaleDateString() : '—'}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">القسم</span>
                                <span>{employee.department}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">الراتب الأساسي</span>
                                <span>{employee.salary?.toLocaleString()} {employee.currency}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Main Content Tabs */}
                <div className="md:col-span-2">
                    <Tabs defaultValue="overview" className="w-full">
                        <TabsList className="w-full justify-start">
                            <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
                            <TabsTrigger value="salary">الراتب والبدلات</TabsTrigger>
                            <TabsTrigger value="documents">المستندات</TabsTrigger>
                            <TabsTrigger value="attendance">سجل الحضور</TabsTrigger>
                        </TabsList>

                        <TabsContent value="overview" className="space-y-4 mt-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Briefcase className="h-4 w-4" />
                                        معلومات العقد
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-sm text-muted-foreground">نوع العقد</p>
                                            <p className="font-medium">دوام كامل</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-muted-foreground">تاريخ الانتهاء</p>
                                            <p className="font-medium">{employee.contractEndDate ? new Date(employee.contractEndDate).toLocaleDateString() : 'مفتوح'}</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="salary" className="space-y-4 mt-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Banknote className="h-4 w-4" />
                                        هيكل الراتب
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center p-3 bg-slate-50 rounded-md">
                                            <span className="font-medium">الراتب الأساسي</span>
                                            <span className="font-bold">{employee.salary?.toLocaleString()} {employee.currency}</span>
                                        </div>
                                        {/* Placeholder for allowances - to be connected to salary_components */}
                                        <div className="text-center py-4 text-muted-foreground text-sm border-2 border-dashed rounded-md">
                                            لا توجد بدلات إضافية مسجلة
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="documents" className="mt-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <FileText className="h-4 w-4" />
                                        المستندات الرسمية
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-md">
                                        لا توجد مستندات مرفقة (الهوية، العقد، الشهادات)
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    );
};
