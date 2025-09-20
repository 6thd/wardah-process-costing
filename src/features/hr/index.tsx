import { Routes, Route, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getSupabase } from '@/lib/supabase'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { 
  FilePlus2, 
  Loader2, 
  Calendar, 
  Clock, 
  DollarSign, 
  User, 
  Users, 
  CalendarClock,
  FileText,
  CheckCircle,
  XCircle,
  AlertCircle
} from 'lucide-react'

// Types for HR module
interface Employee {
  id: string
  org_id: string
  employee_id: string
  first_name: string
  last_name: string
  full_name: string
  email: string
  phone: string
  date_of_birth: string
  gender: string
  nationality: string
  id_number: string
  passport_number: string
  hire_date: string
  termination_date: string | null
  status: string
  department: string
  position: string
  grade_level: string
  manager_id: string | null
  salary: number
  currency: string
  bank_name: string
  bank_account: string
  iban: string
  notes: string
  created_at: string
  updated_at: string
}

interface AttendanceRecord {
  id: string
  org_id: string
  employee_id: string
  record_date: string
  check_in_time: string | null
  check_out_time: string | null
  hours_worked: number
  status: 'present' | 'absent' | 'late' | 'early_departure' | 'leave'
  leave_type: string | null
  notes: string
  created_at: string
  updated_at: string
}

interface LeaveRequest {
  id: string
  org_id: string
  employee_id: string
  leave_type_id: string
  start_date: string
  end_date: string
  total_days: number
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  approved_by: string | null
  approved_at: string | null
  notes: string
  created_at: string
  updated_at: string
}

interface PayrollData {
  overtimePay: number
  absenceDeduction: number
  netSalary: number
  totalAllowances: number
  grossSalary: number
  totalDeductions: number
}

// Utility functions
const REGULAR_HOURS_PER_DAY = 8
const CURRENCY = 'ريال'

const MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
]

function calculatePayroll(employee: Employee, attendanceRecords: AttendanceRecord[], year: number, month: number): PayrollData {
  // Calculate attendance statistics
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  let totalRegular = 0, totalOvertime = 0, absentDays = 0, annualLeaveDays = 0, sickLeaveDays = 0

  for (let day = 1; day <= daysInMonth; day++) {
    const recordDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const record = attendanceRecords.find(r => r.record_date === recordDate)
    
    if (record) {
      switch (record.status) {
        case 'present':
          totalRegular += record.hours_worked > REGULAR_HOURS_PER_DAY ? REGULAR_HOURS_PER_DAY : record.hours_worked
          totalOvertime += record.hours_worked > REGULAR_HOURS_PER_DAY ? record.hours_worked - REGULAR_HOURS_PER_DAY : 0
          break
        case 'absent':
          absentDays++
          break
        case 'leave':
          if (record.leave_type === 'annual') {
            annualLeaveDays++
          } else if (record.leave_type === 'sick') {
            sickLeaveDays++
          }
          break
        default:
          break
      }
    }
  }

  // Calculate payroll
  const totalAllowances = 0 // This would come from salary components
  const deductibleGrossSalary = (employee.salary || 0) + totalAllowances
  const dailyRate = deductibleGrossSalary / 30
  const hourlyRate = ((employee.salary || 0) / 30) / REGULAR_HOURS_PER_DAY
  const overtimePay = totalOvertime * hourlyRate * 1.5
  const absenceAndLeaveDays = absentDays + annualLeaveDays + sickLeaveDays
  const absenceDeduction = dailyRate * absenceAndLeaveDays
  const grossSalary = deductibleGrossSalary + overtimePay
  const totalDeductions = absenceDeduction + 0 // This would come from salary deductions
  const netSalary = grossSalary - totalDeductions
  
  return { 
    overtimePay: parseFloat(overtimePay.toFixed(2)),
    absenceDeduction: parseFloat(absenceDeduction.toFixed(2)),
    netSalary: parseFloat(netSalary.toFixed(2)),
    totalAllowances: parseFloat(totalAllowances.toFixed(2)),
    grossSalary: parseFloat(grossSalary.toFixed(2)),
    totalDeductions: parseFloat(totalDeductions.toFixed(2)),
  }
}

function getFridaysInMonth(year: number, month: number): number[] {
  const fridays = []
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  for (let day = 1; day <= daysInMonth; day++) {
    if (new Date(year, month, day).getDay() === 5) { // Friday is 5 in JavaScript (0=Sunday)
      fridays.push(day)
    }
  }
  return fridays
}

function getAttendanceStatusForDay(record: AttendanceRecord | undefined, isFriday: boolean): 'present' | 'absent' | 'on_leave' | 'weekend' | 'no_data' {
  if (isFriday) return 'weekend'
  if (!record) return 'no_data'
  
  switch (record.status) {
    case 'present':
      return 'present'
    case 'absent':
      return 'absent'
    case 'leave':
      return 'on_leave'
    default:
      return 'no_data'
  }
}

function getCellContent(record: AttendanceRecord | undefined) {
  if (!record) return '-'
  switch (record.status) {
    case 'present':
      return record.hours_worked > 0 ? record.hours_worked.toFixed(1) : '-'
    case 'leave':
      if (record.leave_type === 'annual') return 'س'
      if (record.leave_type === 'sick') return 'م'
      return 'إ'
    case 'absent': 
      return 'غ'
    default: 
      return '-'
  }
}

function getCellClass(record: AttendanceRecord | undefined, isFriday: boolean) {
  let cellClass = ''
  if (record) {
    switch (record.status) {
      case 'leave':
        if (record.leave_type === 'annual') {
          cellClass = 'bg-blue-200 dark:bg-blue-900'
        } else if (record.leave_type === 'sick') {
          cellClass = 'bg-yellow-200 dark:bg-yellow-900'
        } else {
          cellClass = 'bg-purple-200 dark:bg-purple-900'
        }
        break
      case 'absent': 
        cellClass = 'bg-red-200 dark:bg-red-900' 
        break
      default: 
        break
    }
  }
  if (isFriday) cellClass += ' bg-slate-200 dark:bg-slate-700'
  return cellClass
}

export function HRModule() {
  return (
    <Routes>
      <Route path="/" element={<HROverview />} />
      <Route path="/overview" element={<HROverview />} />
      <Route path="/employees" element={<EmployeeManagement />} />
      <Route path="/payroll" element={<PayrollManagement />} />
      <Route path="/attendance" element={<AttendanceManagement />} />
      <Route path="/departments" element={<DepartmentManagement />} />
      <Route path="/positions" element={<PositionManagement />} />
      <Route path="/leave-types" element={<LeaveTypeManagement />} />
      <Route path="/reports" element={<HRReports />} />
      <Route path="*" element={<Navigate to="/hr/overview" replace />} />
    </Routes>
  )
}

function HROverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [summary, setSummary] = useState({
    totalEmployees: 0,
    activeEmployees: 0,
    totalDepartments: 0,
    totalPositions: 0,
    pendingLeaves: 0,
    pendingAttendance: 0
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSummary()
  }, [])

  const loadSummary = async () => {
    try {
      const client = await getSupabase()
      if (!client) throw new Error('Supabase client not initialized')
      
      // Load employee summary
      const { count: totalEmployees, error: countError } = await client
        .from('employees')
        .select('*', { count: 'exact', head: true })

      if (countError) throw countError

      const { count: activeEmployees, error: activeError } = await client
        .from('employees')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')

      if (activeError) throw activeError

      // Load departments count
      const { count: totalDepartments, error: deptError } = await client
        .from('departments')
        .select('*', { count: 'exact', head: true })

      if (deptError) throw deptError

      // Load positions count
      const { count: totalPositions, error: posError } = await client
        .from('positions')
        .select('*', { count: 'exact', head: true })

      if (posError) throw posError

      setSummary({
        totalEmployees: totalEmployees || 0,
        activeEmployees: activeEmployees || 0,
        totalDepartments: totalDepartments || 0,
        totalPositions: totalPositions || 0,
        pendingLeaves: 0,
        pendingAttendance: 0
      })
    } catch (error) {
      console.error('Error loading HR summary:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">{t('hr.title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('hr.overview')}
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('hr.employee.totalEmployees')}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalEmployees}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('hr.employee.activeEmployees')}</CardTitle>
            <User className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.activeEmployees}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('hr.department.title')}</CardTitle>
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('hr.position.title')}</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
          </CardContent>
        </Card>
      </div>

      {/* HR Functions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card className="hover:bg-accent transition-colors cursor-pointer">
          <CardHeader>
            <CardTitle>{t('hr.employees')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('hr.employee.management')}
            </p>
          </CardContent>
        </Card>

        <Card className="hover:bg-accent transition-colors cursor-pointer">
          <CardHeader>
            <CardTitle>{t('hr.payroll.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('hr.payroll.management')}
            </p>
          </CardContent>
        </Card>

        <Card className="hover:bg-accent transition-colors cursor-pointer">
          <CardHeader>
            <CardTitle>{t('hr.attendance.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('hr.attendance.tracking')}
            </p>
          </CardContent>
        </Card>

        <Card className="hover:bg-accent transition-colors cursor-pointer">
          <CardHeader>
            <CardTitle>{t('hr.department.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('hr.department.management')}
            </p>
          </CardContent>
        </Card>

        <Card className="hover:bg-accent transition-colors cursor-pointer">
          <CardHeader>
            <CardTitle>{t('hr.position.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('hr.position.management')}
            </p>
          </CardContent>
        </Card>

        <Card className="hover:bg-accent transition-colors cursor-pointer">
          <CardHeader>
            <CardTitle>{t('hr.leave.type.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('hr.leave.type.management')}
            </p>
          </CardContent>
        </Card>

        <Card className="hover:bg-accent transition-colors cursor-pointer">
          <CardHeader>
            <CardTitle>{t('hr.reports')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('hr.report.management')}
            </p>
          </CardContent>
        </Card>

        <Card className="hover:bg-accent transition-colors cursor-pointer">
          <CardHeader>
            <CardTitle>{t('hr.settings')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('hr.setting.management')}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function EmployeeManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadEmployees()
  }, [])

  const loadEmployees = async () => {
    try {
      const client = await getSupabase()
      if (!client) throw new Error('Supabase client not initialized')
      
      const { data, error } = await client
        .from('employees')
        .select('*')
        .order('full_name')

      if (error) throw error
      setEmployees(data || [])
    } catch (error) {
      console.error('Error loading employees:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t('hr.employees')}</h1>
          <p className="text-muted-foreground">{t('hr.employee.management')}</p>
        </div>
        <Button>
          <FilePlus2 className="ml-2 h-4 w-4" />
          {t('hr.employee.add')}
        </Button>
      </div>
      
      {loading ? (
        <div className="flex justify-center items-center h-32">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('hr.employee.list')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('hr.employee.name')}</TableHead>
                  <TableHead>{t('hr.employee.id')}</TableHead>
                  <TableHead>{t('hr.employee.position')}</TableHead>
                  <TableHead>{t('hr.employee.department')}</TableHead>
                  <TableHead>{t('hr.employee.status')}</TableHead>
                  <TableHead>{t('hr.employee.salary')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell className="font-medium">{employee.full_name}</TableCell>
                    <TableCell>{employee.employee_id}</TableCell>
                    <TableCell>{employee.position}</TableCell>
                    <TableCell>{employee.department}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        employee.status === 'active' 
                          ? 'bg-green-100 text-green-800' 
                          : employee.status === 'terminated'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {t(`hr.employee.status.${employee.status}`)}
                      </span>
                    </TableCell>
                    <TableCell>{employee.salary} {employee.currency}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function PayrollManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth())
  const [employees, setEmployees] = useState<Employee[]>([])
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPayrollData()
  }, [year, month])

  const loadPayrollData = async () => {
    try {
      const client = await getSupabase()
      if (!client) throw new Error('Supabase client not initialized')
      
      // Load employees
      const { data: employeesData, error: employeesError } = await client
        .from('employees')
        .select('*')
        .eq('status', 'active')
        .order('full_name')

      if (employeesError) throw employeesError

      // Load attendance records for the selected month
      const startDate = new Date(year, month, 1).toISOString().split('T')[0]
      const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0]
      
      const { data: attendanceData, error: attendanceError } = await client
        .from('attendance_records')
        .select('*')
        .gte('record_date', startDate)
        .lte('record_date', endDate)

      if (attendanceError) throw attendanceError

      setEmployees(employeesData || [])
      setAttendanceRecords(attendanceData || [])
    } catch (error) {
      console.error('Error loading payroll data:', error)
    } finally {
      setLoading(false)
    }
  }

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t('hr.payroll.title')}</h1>
          <p className="text-muted-foreground">{t('hr.payroll.management')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(month)}
            onValueChange={(value) => setMonth(Number(value))}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder={t('common.month')} />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={String(i)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(year)}
            onValueChange={(value) => setYear(Number(value))}
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue placeholder={t('common.year')} />
            </SelectTrigger>
            <SelectContent>
              {years.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {loading ? (
        <div className="flex justify-center items-center h-32">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('hr.payroll.salarySheet')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('hr.employee.name')}</TableHead>
                  <TableHead>{t('hr.employee.id')}</TableHead>
                  <TableHead>{t('hr.payroll.grossSalary')}</TableHead>
                  <TableHead>{t('hr.payroll.totalDeductions')}</TableHead>
                  <TableHead>{t('hr.payroll.netSalary')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((employee) => {
                  const payroll = calculatePayroll(employee, attendanceRecords, year, month)
                  return (
                    <TableRow key={employee.id}>
                      <TableCell className="font-medium">{employee.full_name}</TableCell>
                      <TableCell>{employee.employee_id}</TableCell>
                      <TableCell>{payroll.grossSalary.toFixed(2)} {CURRENCY}</TableCell>
                      <TableCell>{payroll.totalDeductions.toFixed(2)} {CURRENCY}</TableCell>
                      <TableCell className="font-bold">{payroll.netSalary.toFixed(2)} {CURRENCY}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function AttendanceManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth())
  const [employees, setEmployees] = useState<Employee[]>([])
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAttendanceData()
  }, [year, month])

  const loadAttendanceData = async () => {
    try {
      const client = await getSupabase()
      if (!client) throw new Error('Supabase client not initialized')
      
      // Load employees
      const { data: employeesData, error: employeesError } = await client
        .from('employees')
        .select('*')
        .eq('status', 'active')
        .order('full_name')

      if (employeesError) throw employeesError

      // Load attendance records for the selected month
      const startDate = new Date(year, month, 1).toISOString().split('T')[0]
      const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0]
      
      const { data: attendanceData, error: attendanceError } = await client
        .from('attendance_records')
        .select('*')
        .gte('record_date', startDate)
        .lte('record_date', endDate)

      if (attendanceError) throw attendanceError

      setEmployees(employeesData || [])
      setAttendanceRecords(attendanceData || [])
    } catch (error) {
      console.error('Error loading attendance data:', error)
    } finally {
      setLoading(false)
    }
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const fridays = getFridaysInMonth(year, month)
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t('hr.attendance.title')}</h1>
          <p className="text-muted-foreground">{t('hr.attendance.tracking')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(month)}
            onValueChange={(value) => setMonth(Number(value))}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder={t('common.month')} />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={String(i)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(year)}
            onValueChange={(value) => setYear(Number(value))}
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue placeholder={t('common.year')} />
            </SelectTrigger>
            <SelectContent>
              {years.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {loading ? (
        <div className="flex justify-center items-center h-32">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('hr.attendance.monthlyReport')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-200 text-gray-600 uppercase hover:bg-gray-200">
                    <TableHead className="sticky left-0 bg-gray-200 z-10 w-36 text-right">{t('hr.employee.name')}</TableHead>
                    {daysArray.map(day => (
                      <TableHead 
                        key={day} 
                        className={cn("p-3 w-12 text-center", fridays.includes(day) && 'bg-slate-300')}
                      >
                        {day}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-gray-200">
                  {employees.map(employee => (
                    <TableRow key={employee.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <TableCell className="font-bold sticky left-0 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-gray-800 z-10">
                        {employee.full_name}
                      </TableCell>
                      {daysArray.map(day => {
                        const recordDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                        const record = attendanceRecords.find(r => 
                          r.employee_id === employee.id && r.record_date === recordDate
                        )
                        return (
                          <TableCell
                            key={day}
                            className={cn(
                              "p-1 text-center",
                              getCellClass(record, fridays.includes(day))
                            )}
                          >
                            {getCellContent(record)}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function HRReports() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('hr.reports')}</h1>
        <p className="text-muted-foreground">{t('hr.report.management')}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card className="hover:bg-accent transition-colors cursor-pointer">
          <CardHeader>
            <CardTitle>{t('hr.employee.list')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('hr.report.employeeList')}
            </p>
          </CardContent>
        </Card>
        
        <Card className="hover:bg-accent transition-colors cursor-pointer">
          <CardHeader>
            <CardTitle>{t('hr.payroll.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('hr.report.payrollSummary')}
            </p>
          </CardContent>
        </Card>
        
        <Card className="hover:bg-accent transition-colors cursor-pointer">
          <CardHeader>
            <CardTitle>{t('hr.attendance.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('hr.report.attendanceSummary')}
            </p>
          </CardContent>
        </Card>
        
        <Card className="hover:bg-accent transition-colors cursor-pointer">
          <CardHeader>
            <CardTitle>{t('hr.leave.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('hr.report.leaveSummary')}
            </p>
          </CardContent>
        </Card>
        
        <Card className="hover:bg-accent transition-colors cursor-pointer">
          <CardHeader>
            <CardTitle>{t('hr.payroll.salarySheet')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('hr.report.detailedPayroll')}
            </p>
          </CardContent>
        </Card>
        
        <Card className="hover:bg-accent transition-colors cursor-pointer">
          <CardHeader>
            <CardTitle>{t('hr.employee.management')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('hr.report.employeeDetails')}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Types for additional HR entities
interface Department {
  id: string
  org_id: string
  code: string
  name: string
  name_ar: string
  description: string
  manager_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

interface Position {
  id: string
  org_id: string
  code: string
  name: string
  name_ar: string
  description: string
  department_id: string
  is_active: boolean
  created_at: string
  updated_at: string
}

interface LeaveType {
  id: string
  org_id: string
  code: string
  name: string
  name_ar: string
  description: string
  is_paid: boolean
  max_days_per_year: number
  is_active: boolean
  created_at: string
  updated_at: string
}

function DepartmentManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDepartments()
  }, [])

  const loadDepartments = async () => {
    try {
      const client = await getSupabase()
      if (!client) throw new Error('Supabase client not initialized')
      
      const { data, error } = await client
        .from('departments')
        .select('*')
        .order('name')

      if (error) throw error
      setDepartments(data || [])
    } catch (error) {
      console.error('Error loading departments:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t('hr.department.title')}</h1>
          <p className="text-muted-foreground">{t('hr.department.management')}</p>
        </div>
        <Button>
          <FilePlus2 className="ml-2 h-4 w-4" />
          {t('hr.department.add')}
        </Button>
      </div>
      
      {loading ? (
        <div className="flex justify-center items-center h-32">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('hr.department.list')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.code')}</TableHead>
                  <TableHead>{t('common.name')}</TableHead>
                  <TableHead>{t('hr.department.manager')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.map((department) => (
                  <TableRow key={department.id}>
                    <TableCell className="font-medium">{department.code}</TableCell>
                    <TableCell>{i18n.language === 'ar' ? department.name_ar : department.name}</TableCell>
                    <TableCell>{department.manager_id ? 'Manager Name' : '-'}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        department.is_active 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {department.is_active ? t('common.active') : t('common.inactive')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" className="ml-2">
                        {t('common.edit')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function PositionManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPositions()
  }, [])

  const loadPositions = async () => {
    try {
      const client = await getSupabase()
      if (!client) throw new Error('Supabase client not initialized')
      
      const { data, error } = await client
        .from('positions')
        .select('*')
        .order('name')

      if (error) throw error
      setPositions(data || [])
    } catch (error) {
      console.error('Error loading positions:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t('hr.position.title')}</h1>
          <p className="text-muted-foreground">{t('hr.position.management')}</p>
        </div>
        <Button>
          <FilePlus2 className="ml-2 h-4 w-4" />
          {t('hr.position.add')}
        </Button>
      </div>
      
      {loading ? (
        <div className="flex justify-center items-center h-32">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('hr.position.list')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.code')}</TableHead>
                  <TableHead>{t('common.name')}</TableHead>
                  <TableHead>{t('hr.position.department')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((position) => (
                  <TableRow key={position.id}>
                    <TableCell className="font-medium">{position.code}</TableCell>
                    <TableCell>{i18n.language === 'ar' ? position.name_ar : position.name}</TableCell>
                    <TableCell>Department Name</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        position.is_active 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {position.is_active ? t('common.active') : t('common.inactive')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" className="ml-2">
                        {t('common.edit')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function LeaveTypeManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadLeaveTypes()
  }, [])

  const loadLeaveTypes = async () => {
    try {
      const client = await getSupabase()
      if (!client) throw new Error('Supabase client not initialized')
      
      const { data, error } = await client
        .from('leave_types')
        .select('*')
        .order('name')

      if (error) throw error
      setLeaveTypes(data || [])
    } catch (error) {
      console.error('Error loading leave types:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t('hr.leave.type.title')}</h1>
          <p className="text-muted-foreground">{t('hr.leave.type.management')}</p>
        </div>
        <Button>
          <FilePlus2 className="ml-2 h-4 w-4" />
          {t('hr.leave.type.add')}
        </Button>
      </div>
      
      {loading ? (
        <div className="flex justify-center items-center h-32">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('hr.leave.type.list')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.code')}</TableHead>
                  <TableHead>{t('common.name')}</TableHead>
                  <TableHead>{t('hr.leave.type.isPaid')}</TableHead>
                  <TableHead>{t('hr.leave.type.maxDays')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaveTypes.map((leaveType) => (
                  <TableRow key={leaveType.id}>
                    <TableCell className="font-medium">{leaveType.code}</TableCell>
                    <TableCell>{i18n.language === 'ar' ? leaveType.name_ar : leaveType.name}</TableCell>
                    <TableCell>
                      {leaveType.is_paid ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </TableCell>
                    <TableCell>{leaveType.max_days_per_year || '-'}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        leaveType.is_active 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {leaveType.is_active ? t('common.active') : t('common.inactive')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" className="ml-2">
                        {t('common.edit')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}