import { Routes, Route, Navigate } from 'react-router-dom'

export function UsersModule() {
  return (
    <Routes>
      <Route path="/" element={<UsersOverview />} />
      <Route path="/overview" element={<UsersOverview />} />
      <Route path="/manage" element={<UsersManagement />} />
      <Route path="/roles" element={<RolesManagement />} />
      <Route path="*" element={<Navigate to="/users/overview" replace />} />
    </Routes>
  )
}

function UsersOverview() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold">إدارة المستخدمين</h1>
        <p className="text-muted-foreground mt-2">
          إدارة المستخدمين والأدوار والصلاحيات
        </p>
        <div className="mt-8 p-8 bg-muted/50 rounded-lg">
          <p>سيتم تطوير هذا القسم قريباً</p>
        </div>
      </div>
    </div>
  )
}

function UsersManagement() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">إدارة المستخدمين</h1>
      <div className="p-8 bg-muted/50 rounded-lg">
        <p>سيتم تطوير هذا القسم قريباً</p>
      </div>
    </div>
  )
}

function RolesManagement() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">إدارة الأدوار</h1>
      <div className="p-8 bg-muted/50 rounded-lg">
        <p>سيتم تطوير هذا القسم قريباً</p>
      </div>
    </div>
  )
}