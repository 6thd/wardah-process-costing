/**
 * Process Costing Report
 * Detailed equivalent units and variance analysis report
 */

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts'
import { 
  Download, Printer, 
  AlertTriangle, CheckCircle, DollarSign
} from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

// Types
interface ManufacturingOrder {
  id: string
  orderNumber: string
  itemId: string
  itemName: string
  quantity: number
  status: string
  startDate: string
  endDate?: string
}

interface PhysicalFlow {
  description: string
  units: number
}

interface EquivalentUnits {
  stage: string
  beginningWip: number
  unitsStarted: number
  unitsCompleted: number
  endingWip: number
  materialCompletion: number
  conversionCompletion: number
  equivalentUnitsMaterial: number
  equivalentUnitsConversion: number
}

interface CostSummary {
  stage: string
  materialCost: number
  laborCost: number
  overheadCost: number
  totalCost: number
  costPerEquivalentUnitMaterial: number
  costPerEquivalentUnitConversion: number
}

interface VarianceAnalysis {
  stage: string
  standardMaterial: number
  actualMaterial: number
  materialVariance: number
  materialVariancePercent: number
  standardLabor: number
  actualLabor: number
  laborVariance: number
  laborVariancePercent: number
  standardOverhead: number
  actualOverhead: number
  overheadVariance: number
  overheadVariancePercent: number
  totalVariance: number
  totalVariancePercent: number
}

// Mock data for demonstration
const mockMOs: ManufacturingOrder[] = [
  { id: 'mo-1', orderNumber: 'MO-2023-001', itemId: 'item-1', itemName: 'Plastic Bottles 500ml', quantity: 10000, status: 'Completed', startDate: '2023-06-01', endDate: '2023-06-15' },
  { id: 'mo-2', orderNumber: 'MO-2023-002', itemId: 'item-2', itemName: 'Plastic Caps', quantity: 50000, status: 'Completed', startDate: '2023-06-05', endDate: '2023-06-20' },
  { id: 'mo-3', orderNumber: 'MO-2023-003', itemId: 'item-3', itemName: 'Label Stickers', quantity: 25000, status: 'In Progress', startDate: '2023-06-10' },
]

const mockPhysicalFlow: PhysicalFlow[] = [
  { description: 'Beginning Work in Process (WIP)', units: 1000 },
  { description: 'Units Started During Period', units: 10000 },
  { description: 'Total Units to Account For', units: 11000 },
  { description: 'Units Completed and Transferred Out', units: 9500 },
  { description: 'Ending Work in Process (WIP)', units: 1500 },
  { description: 'Total Units Accounted For', units: 11000 },
]

const mockEquivalentUnits: EquivalentUnits[] = [
  {
    stage: 'Stage 10 - Rolling',
    beginningWip: 1000,
    unitsStarted: 10000,
    unitsCompleted: 9500,
    endingWip: 1500,
    materialCompletion: 100,
    conversionCompletion: 80,
    equivalentUnitsMaterial: 11000,
    equivalentUnitsConversion: 10700
  },
  {
    stage: 'Stage 20 - Transparency Processing',
    beginningWip: 500,
    unitsStarted: 9500,
    unitsCompleted: 9000,
    endingWip: 1000,
    materialCompletion: 100,
    conversionCompletion: 60,
    equivalentUnitsMaterial: 10000,
    equivalentUnitsConversion: 9600
  },
  {
    stage: 'Stage 30 - Lid Formation',
    beginningWip: 300,
    unitsStarted: 9000,
    unitsCompleted: 8800,
    endingWip: 500,
    materialCompletion: 100,
    conversionCompletion: 40,
    equivalentUnitsMaterial: 9300,
    equivalentUnitsConversion: 9000
  }
]

const mockCostSummary: CostSummary[] = [
  {
    stage: 'Stage 10 - Rolling',
    materialCost: 5500,
    laborCost: 2140,
    overheadCost: 1605,
    totalCost: 9245,
    costPerEquivalentUnitMaterial: 0.50,
    costPerEquivalentUnitConversion: 0.86
  },
  {
    stage: 'Stage 20 - Transparency Processing',
    materialCost: 0,
    laborCost: 1920,
    overheadCost: 1440,
    totalCost: 3360,
    costPerEquivalentUnitMaterial: 0,
    costPerEquivalentUnitConversion: 0.35
  },
  {
    stage: 'Stage 30 - Lid Formation',
    materialCost: 0,
    laborCost: 1800,
    overheadCost: 1350,
    totalCost: 3150,
    costPerEquivalentUnitMaterial: 0,
    costPerEquivalentUnitConversion: 0.35
  }
]

const mockVarianceAnalysis: VarianceAnalysis[] = [
  {
    stage: 'Stage 10 - Rolling',
    standardMaterial: 5000,
    actualMaterial: 5500,
    materialVariance: 500,
    materialVariancePercent: 10,
    standardLabor: 2000,
    actualLabor: 2140,
    laborVariance: 140,
    laborVariancePercent: 7,
    standardOverhead: 1500,
    actualOverhead: 1605,
    overheadVariance: 105,
    overheadVariancePercent: 7,
    totalVariance: 745,
    totalVariancePercent: 8.1
  },
  {
    stage: 'Stage 20 - Transparency Processing',
    standardMaterial: 0,
    actualMaterial: 0,
    materialVariance: 0,
    materialVariancePercent: 0,
    standardLabor: 1800,
    actualLabor: 1920,
    laborVariance: 120,
    laborVariancePercent: 6.67,
    standardOverhead: 1350,
    actualOverhead: 1440,
    overheadVariance: 90,
    overheadVariancePercent: 6.67,
    totalVariance: 210,
    totalVariancePercent: 6.67
  }
]

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8']

export function ProcessCostingReport() {
  const { toast } = useToast()
  
  // State
  const [selectedMO, setSelectedMO] = useState<string>('')
  const [reportPeriod, setReportPeriod] = useState<string>('current')
  
  // Handlers
  const handleExportPDF = () => {
    toast({
      title: "Export Started",
      description: "Generating PDF report..."
    })
    // In a real implementation, this would generate and download a PDF
  }
  
  const handlePrint = () => {
    toast({
      title: "Print Started",
      description: "Preparing document for printing..."
    })
    // In a real implementation, this would open the print dialog
  }
  
  // Render functions
  const renderPhysicalFlowTable = () => {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-3/4">Physical Flow Description</TableHead>
            <TableHead className="text-right">Units</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mockPhysicalFlow.map((item, index) => (
            <TableRow key={index}>
              <TableCell>{item.description}</TableCell>
              <TableCell className="text-right font-mono">{item.units.toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }
  
  const renderEquivalentUnitsTable = () => {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stage</TableHead>
            <TableHead className="text-right">Beginning WIP</TableHead>
            <TableHead className="text-right">Units Started</TableHead>
            <TableHead className="text-right">Completed</TableHead>
            <TableHead className="text-right">Ending WIP</TableHead>
            <TableHead className="text-right">Material %</TableHead>
            <TableHead className="text-right">Conversion %</TableHead>
            <TableHead className="text-right">EU Material</TableHead>
            <TableHead className="text-right">EU Conversion</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mockEquivalentUnits.map((item, index) => (
            <TableRow key={index}>
              <TableCell>{item.stage}</TableCell>
              <TableCell className="text-right font-mono">{item.beginningWip.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono">{item.unitsStarted.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono">{item.unitsCompleted.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono">{item.endingWip.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono">{item.materialCompletion}%</TableCell>
              <TableCell className="text-right font-mono">{item.conversionCompletion}%</TableCell>
              <TableCell className="text-right font-mono">{item.equivalentUnitsMaterial.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono">{item.equivalentUnitsConversion.toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }
  
  const renderCostSummaryTable = () => {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stage</TableHead>
            <TableHead className="text-right">Material Cost</TableHead>
            <TableHead className="text-right">Labor Cost</TableHead>
            <TableHead className="text-right">Overhead Cost</TableHead>
            <TableHead className="text-right">Total Cost</TableHead>
            <TableHead className="text-right">Cost/EU Material</TableHead>
            <TableHead className="text-right">Cost/EU Conversion</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mockCostSummary.map((item, index) => (
            <TableRow key={index}>
              <TableCell>{item.stage}</TableCell>
              <TableCell className="text-right font-mono">${item.materialCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
              <TableCell className="text-right font-mono">${item.laborCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
              <TableCell className="text-right font-mono">${item.overheadCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
              <TableCell className="text-right font-mono">${item.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
              <TableCell className="text-right font-mono">${item.costPerEquivalentUnitMaterial.toFixed(2)}</TableCell>
              <TableCell className="text-right font-mono">${item.costPerEquivalentUnitConversion.toFixed(2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }
  
  const renderVarianceAnalysisTable = () => {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stage</TableHead>
            <TableHead className="text-right">Standard Material</TableHead>
            <TableHead className="text-right">Actual Material</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            <TableHead className="text-right">%</TableHead>
            <TableHead className="text-right">Standard Labor</TableHead>
            <TableHead className="text-right">Actual Labor</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            <TableHead className="text-right">%</TableHead>
            <TableHead className="text-right">Standard Overhead</TableHead>
            <TableHead className="text-right">Actual Overhead</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            <TableHead className="text-right">%</TableHead>
            <TableHead className="text-right">Total Variance</TableHead>
            <TableHead className="text-right">%</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mockVarianceAnalysis.map((item, index) => (
            <TableRow key={index}>
              <TableCell>{item.stage}</TableCell>
              <TableCell className="text-right font-mono">${item.standardMaterial.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
              <TableCell className="text-right font-mono">${item.actualMaterial.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
              <TableCell className={`text-right font-mono ${item.materialVariance > 0 ? 'text-red-500' : 'text-green-500'}`}>
                ${item.materialVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </TableCell>
              <TableCell className={`text-right font-mono ${item.materialVariancePercent > 5 ? 'text-red-500' : ''}`}>
                {item.materialVariancePercent.toFixed(2)}%
              </TableCell>
              <TableCell className="text-right font-mono">${item.standardLabor.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
              <TableCell className="text-right font-mono">${item.actualLabor.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
              <TableCell className={`text-right font-mono ${item.laborVariance > 0 ? 'text-red-500' : 'text-green-500'}`}>
                ${item.laborVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </TableCell>
              <TableCell className={`text-right font-mono ${item.laborVariancePercent > 5 ? 'text-red-500' : ''}`}>
                {item.laborVariancePercent.toFixed(2)}%
              </TableCell>
              <TableCell className="text-right font-mono">${item.standardOverhead.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
              <TableCell className="text-right font-mono">${item.actualOverhead.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
              <TableCell className={`text-right font-mono ${item.overheadVariance > 0 ? 'text-red-500' : 'text-green-500'}`}>
                ${item.overheadVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </TableCell>
              <TableCell className={`text-right font-mono ${item.overheadVariancePercent > 5 ? 'text-red-500' : ''}`}>
                {item.overheadVariancePercent.toFixed(2)}%
              </TableCell>
              <TableCell className={`text-right font-mono ${item.totalVariance > 0 ? 'text-red-500' : 'text-green-500'}`}>
                ${item.totalVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </TableCell>
              <TableCell className={`text-right font-mono ${item.totalVariancePercent > 5 ? 'text-red-500' : ''}`}>
                {item.totalVariancePercent.toFixed(2)}%
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }
  
  const renderVarianceChart = () => {
    // Prepare data for chart
    const chartData = mockVarianceAnalysis.map(item => ({
      stage: item.stage.replace('Stage ', '').split(' - ')[0],
      materialVariance: item.materialVariancePercent,
      laborVariance: item.laborVariancePercent,
      overheadVariance: item.overheadVariancePercent,
      totalVariance: item.totalVariancePercent
    }))
    
    return (
      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="stage" />
          <YAxis unit="%" />
          <Tooltip />
          <Legend />
          <Bar dataKey="materialVariance" name="Material Variance %" fill="#8884d8" />
          <Bar dataKey="laborVariance" name="Labor Variance %" fill="#82ca9d" />
          <Bar dataKey="overheadVariance" name="Overhead Variance %" fill="#ffc658" />
        </BarChart>
      </ResponsiveContainer>
    )
  }
  
  const renderCostBreakdownChart = () => {
    const totalMaterial = mockCostSummary.reduce((sum, item) => sum + item.materialCost, 0)
    const totalLabor = mockCostSummary.reduce((sum, item) => sum + item.laborCost, 0)
    const totalOverhead = mockCostSummary.reduce((sum, item) => sum + item.overheadCost, 0)
    
    const chartData = [
      { name: 'Material', value: totalMaterial },
      { name: 'Labor', value: totalLabor },
      { name: 'Overhead', value: totalOverhead },
    ]
    
    return (
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            labelLine={true}
            outerRadius={80}
            fill="#8884d8"
            dataKey="value"
          >
            {chartData.map((_entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => [`$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'Amount']} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Process Costing Report</h1>
          <p className="text-muted-foreground">Detailed equivalent units and variance analysis</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleExportPDF}>
            <Download className="mr-2 h-4 w-4" />
            Export PDF
          </Button>
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
      </div>
      
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Report Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mo-select">Manufacturing Order</Label>
              <Select value={selectedMO} onValueChange={setSelectedMO}>
                <SelectTrigger id="mo-select">
                  <SelectValue placeholder="Select manufacturing order" />
                </SelectTrigger>
                <SelectContent>
                  {mockMOs.map((mo) => (
                    <SelectItem key={mo.id} value={mo.id}>
                      {mo.orderNumber} - {mo.itemName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="period-select">Report Period</Label>
              <Select value={reportPeriod} onValueChange={setReportPeriod}>
                <SelectTrigger id="period-select">
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">Current Period</SelectItem>
                  <SelectItem value="last-month">Last Month</SelectItem>
                  <SelectItem value="last-quarter">Last Quarter</SelectItem>
                  <SelectItem value="ytd">Year to Date</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="date-range">Date Range</Label>
              <div className="flex gap-2">
                <Input id="date-range" type="date" />
                <span className="flex items-center">to</span>
                <Input type="date" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Report Content */}
      <div className="space-y-6">
        {/* Physical Flow Section */}
        <Card>
          <CardHeader>
            <CardTitle>Physical Flow Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            {renderPhysicalFlowTable()}
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-4">Physical Flow Chart</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={mockPhysicalFlow}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="description" />
                    <YAxis />
                    <Tooltip formatter={(value) => [Number(value).toLocaleString(), 'Units']} />
                    <Legend />
                    <Bar dataKey="units" fill="#8884d8" name="Units" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Equivalent Units Section */}
        <Card>
          <CardHeader>
            <CardTitle>Equivalent Units Calculation</CardTitle>
          </CardHeader>
          <CardContent>
            {renderEquivalentUnitsTable()}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Material Equivalent Units</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={mockEquivalentUnits}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="stage" />
                      <YAxis />
                      <Tooltip formatter={(value) => [Number(value).toLocaleString(), 'Units']} />
                      <Legend />
                      <Bar dataKey="equivalentUnitsMaterial" fill="#82ca9d" name="Material EU" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-4">Conversion Equivalent Units</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={mockEquivalentUnits}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="stage" />
                      <YAxis />
                      <Tooltip formatter={(value) => [Number(value).toLocaleString(), 'Units']} />
                      <Legend />
                      <Bar dataKey="equivalentUnitsConversion" fill="#ffc658" name="Conversion EU" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Cost Summary Section */}
        <Card>
          <CardHeader>
            <CardTitle>Cost Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {renderCostSummaryTable()}
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-4">Cost Breakdown</h3>
              {renderCostBreakdownChart()}
            </div>
          </CardContent>
        </Card>
        
        {/* Variance Analysis Section */}
        <Card>
          <CardHeader>
            <CardTitle>Variance Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            {renderVarianceAnalysisTable()}
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-4">Variance Analysis Chart</h3>
              {renderVarianceChart()}
            </div>
          </CardContent>
        </Card>
        
        {/* Summary Section */}
        <Card>
          <CardHeader>
            <CardTitle>Report Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <h3 className="font-semibold">Total Units Produced</h3>
                </div>
                <p className="text-2xl font-bold">9,500</p>
                <p className="text-sm text-muted-foreground">Completed units</p>
              </div>
              
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-5 w-5 text-blue-500" />
                  <h3 className="font-semibold">Total Production Cost</h3>
                </div>
                <p className="text-2xl font-bold">$15,755.00</p>
                <p className="text-sm text-muted-foreground">All stages combined</p>
              </div>
              
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                  <h3 className="font-semibold">Variance Alerts</h3>
                </div>
                <p className="text-2xl font-bold">3</p>
                <p className="text-sm text-muted-foreground">Exceeding 5% threshold</p>
              </div>
            </div>
            
            <div className="mt-6 p-4 bg-muted rounded-lg">
              <h3 className="font-semibold mb-2">Key Insights</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>Material costs in Stage 10 exceeded standard by 10% due to supplier price increase</li>
                <li>Labor efficiency improved in Stage 20 compared to previous period</li>
                <li>Overhead allocation was consistent across all stages</li>
                <li>Total production cost per unit: $1.66</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
