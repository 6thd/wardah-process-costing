import { Routes, Route, Navigate } from 'react-router-dom'

export function ProcessCostingModule() {
  return (
    <Routes>
      <Route path="/" element={<ProcessCostingOverview />} />
      <Route path="/overview" element={<ProcessCostingOverview />} />
      <Route path="*" element={<Navigate to="/process-costing/overview" replace />} />
    </Routes>
  )
}

function ProcessCostingOverview() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold">تكاليف المراحل</h1>
        <p className="text-muted-foreground mt-2">
          نظام متقدم لاحتساب تكاليف مراحل التصنيع
        </p>
        <div className="mt-8 p-8 bg-muted/50 rounded-lg">
          <p>سيتم تطوير هذا القسم قريباً</p>
        </div>
      </div>
    </div>
  )
}