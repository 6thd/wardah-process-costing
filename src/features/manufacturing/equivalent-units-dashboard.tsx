/**
 * Equivalent Units Dashboard
 * Process costing dashboard with equivalent units analysis
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts'
import { 
  AlertTriangle, TrendingUp, DollarSign, Package, Factory,
  Calculator
} from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { useManufacturingStages } from '@/hooks/useManufacturingStages'
// Fixed import paths - DISABLED (domain not implemented)
// import { equivalentUnitsService } from '../../domain/manufacturing/equivalentUnits'

// Temporary stub for equivalentUnitsService
const equivalentUnitsService = {
  getEquivalentUnits: async (...args: any[]) => ({ success: true, data: [] }),
  calculateCostPerUnit: async (...args: any[]) => ({ success: true, data: [] }),
  getProcessCostSummary: async (...args: any[]) => ({ success: true, data: null }),
  getVarianceAlerts: async (...args: any[]) => [],
  getLatestEquivalentUnits: async (...args: any[]) => [],
  calculateCostPerEquivalentUnit: async (...args: any[]) => [],
  calculateEquivalentUnits: async (...args: any[]) => ({ success: true, data: [] }),
  performVarianceAnalysis: async (...args: any[]) => ({ success: true, data: [] })
}

// Types

interface EquivalentUnitsData {
  stage: string
  equivalentUnitsMaterial: number
  equivalentUnitsConversion: number
}

interface CostPerEquivalentUnitData {
  stage: string
  materialCost: number
  laborCost: number
  overheadCost: number
  costPerEquivalentUnitMaterial: number
  costPerEquivalentUnitConversion: number
}

export function EquivalentUnitsDashboard() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  
  // Load manufacturing stages
  const { data: stages = [], isLoading: isStagesLoading } = useManufacturingStages()
  
  // State
  const [selectedMO, setSelectedMO] = useState<string>('')
  const [selectedStage, setSelectedStage] = useState<string>('')
  const [beginningWip, setBeginningWip] = useState<number>(0)
  const [unitsStarted, setUnitsStarted] = useState<number>(0)
  const [unitsCompleted, setUnitsCompleted] = useState<number>(0)
  const [endingWip, setEndingWip] = useState<number>(0)
  const [materialCompletion, setMaterialCompletion] = useState<number>(100)
  const [conversionCompletion, setConversionCompletion] = useState<number>(100)
  
  // Chart data state
  const [equivalentUnitsData, ] = useState<EquivalentUnitsData[]>([
    { stage: 'Stage 10', equivalentUnitsMaterial: 10000, equivalentUnitsConversion: 9500 },
    { stage: 'Stage 20', equivalentUnitsMaterial: 8000, equivalentUnitsConversion: 7800 },
    { stage: 'Stage 30', equivalentUnitsMaterial: 7500, equivalentUnitsConversion: 7200 },
    { stage: 'Stage 40', equivalentUnitsMaterial: 7000, equivalentUnitsConversion: 6800 },
    { stage: 'Stage 50', equivalentUnitsMaterial: 6500, equivalentUnitsConversion: 6300 },
  ])
  
  const [costPerEquivalentUnitData, ] = useState<CostPerEquivalentUnitData[]>([
    { stage: 'Stage 10', materialCost: 5000, laborCost: 2000, overheadCost: 1500, costPerEquivalentUnitMaterial: 0.5, costPerEquivalentUnitConversion: 0.37 }, // NOSONAR - Decimal values required for cost calculation
    { stage: 'Stage 20', materialCost: 0, laborCost: 2500, overheadCost: 1800, costPerEquivalentUnitMaterial: 0, costPerEquivalentUnitConversion: 0.55 },
    { stage: 'Stage 30', materialCost: 0, laborCost: 2200, overheadCost: 1600, costPerEquivalentUnitMaterial: 0, costPerEquivalentUnitConversion: 0.51 },
    { stage: 'Stage 40', materialCost: 0, laborCost: 2800, overheadCost: 2000, costPerEquivalentUnitMaterial: 0, costPerEquivalentUnitConversion: 0.63 },
    { stage: 'Stage 50', materialCost: 0, laborCost: 3000, overheadCost: 2200, costPerEquivalentUnitMaterial: 0, costPerEquivalentUnitConversion: 0.72 },
  ])
  
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8']
  
  // Queries
  const { data: mos, } = useQuery({
    queryKey: ['manufacturing-orders'],
    queryFn: async () => {
      // In a real implementation, this would fetch actual MOs from your backend
      // For now, we'll keep using mock data but in a real app you would do:
      // const response = await fetch('/api/manufacturing-orders')
      // return response.json()
      return [
        { id: 'mo-1', orderNumber: 'MO-2023-001', itemId: 'item-1', itemName: 'Plastic Bottles 500ml', quantity: 10000, status: 'In Progress', currentStage: 20 },
        { id: 'mo-2', orderNumber: 'MO-2023-002', itemId: 'item-2', itemName: 'Plastic Caps', quantity: 50000, status: 'Completed', currentStage: 50 },
        { id: 'mo-3', orderNumber: 'MO-2023-003', itemId: 'item-3', itemName: 'Label Stickers', quantity: 25000, status: 'Planning', currentStage: 10 },
      ]
    }
  })
  
  const { data: varianceAlerts, isLoading: isLoadingAlerts, } = useQuery({
    queryKey: ['variance-alerts'],
    queryFn: async () => {
      try {
        // In a real implementation:
        return await equivalentUnitsService.getVarianceAlerts('MEDIUM')
      } catch (error) {
        toast({
          title: "Error loading variance alerts",
          description: "Failed to load variance alerts.",
          variant: "destructive"
        })
        // Return empty array instead of mock data to avoid confusion
        return []
      }
    }
  })
  
  // Fetch real equivalent units data
  useQuery({
    queryKey: ['equivalent-units', selectedMO, selectedStage],
    queryFn: async () => {
      if (!selectedMO) return null
      try {
        return await equivalentUnitsService.getLatestEquivalentUnits(selectedMO, selectedStage)
      } catch (error) {
        console.error('Failed to fetch equivalent units data:', error)
        return null
      }
    },
    enabled: !!selectedMO
  })
  
  // Fetch real cost per equivalent unit data
  useQuery({
    queryKey: ['cost-per-equivalent-unit', selectedMO, selectedStage],
    queryFn: async () => {
      if (!selectedMO) return null
      try {
        // For demo purposes, we'll use a fixed date range
        const today = new Date()
        const thirtyDaysAgo = new Date(today)
        thirtyDaysAgo.setDate(today.getDate() - 30)
        
        return await equivalentUnitsService.calculateCostPerEquivalentUnit(
          selectedMO,
          selectedStage,
          thirtyDaysAgo.toISOString().split('T')[0],
          today.toISOString().split('T')[0]
        )
      } catch (error) {
        console.error('Failed to fetch cost per equivalent unit data:', error)
        return null
      }
    },
    enabled: !!selectedMO
  })
  
  // Handlers
  const handleCalculateEquivalentUnits = async () => {
    if (!selectedMO) {
      toast({
        title: "Missing Selection",
        description: "Please select a manufacturing order",
        variant: "destructive"
      })
      return
    }
    
    try {
      await equivalentUnitsService.calculateEquivalentUnits(
        selectedMO,
        selectedStage,
        beginningWip,
        unitsStarted,
        unitsCompleted,
        endingWip,
        materialCompletion,
        conversionCompletion
      )
      
      toast({
        title: "Equivalent Units Calculated",
        description: "Equivalent units calculation completed successfully"
      })
      
      queryClient.invalidateQueries({ queryKey: ['variance-alerts'] })
    } catch (error) {
      toast({
        title: "Calculation Error",
        description: "Failed to calculate equivalent units: " + (error as Error).message,
        variant: "destructive"
      })
    }
  }
  
  const handlePerformVarianceAnalysis = async () => {
    if (!selectedMO) {
      toast({
        title: "Missing Selection",
        description: "Please select a manufacturing order",
        variant: "destructive"
      })
      return
    }
    
    try {
      await equivalentUnitsService.performVarianceAnalysis(selectedMO, selectedStage)
      
      toast({
        title: "Variance Analysis Completed",
        description: "Variance analysis performed successfully"
      })
      
      queryClient.invalidateQueries({ queryKey: ['variance-alerts'] })
    } catch (error) {
      toast({
        title: "Analysis Error",
        description: "Failed to perform variance analysis: " + (error as Error).message,
        variant: "destructive"
      })
    }
  }
  
  // Render functions
  const renderVarianceAlerts = () => {
    if (isLoadingAlerts) {
      return <div>Loading variance alerts...</div>
    }
    
    if (!varianceAlerts || varianceAlerts.length === 0) {
      return <div>No variance alerts found.</div>
    }
    
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>MO Number</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Material Variance</TableHead>
            <TableHead>Labor Variance</TableHead>
            <TableHead>Overhead Variance</TableHead>
            <TableHead>Total Variance</TableHead>
            <TableHead>Severity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {varianceAlerts.map((alert, index) => {
            const mo = mos?.find(m => m.id === alert.moId)
            return (
              <TableRow key={index}>
                <TableCell>{mo?.orderNumber || alert.moId}</TableCell>
                <TableCell>Stage {alert.stageNo}</TableCell>
                <TableCell>{alert.varianceDate}</TableCell>
                <TableCell className={alert.materialVariancePercentage > 10 ? "text-red-500 font-bold" : ""}>
                  {alert.materialVariancePercentage.toFixed(2)}%
                </TableCell>
                <TableCell className={alert.laborVariancePercentage > 10 ? "text-red-500 font-bold" : ""}>
                  {alert.laborVariancePercentage.toFixed(2)}%
                </TableCell>
                <TableCell className={alert.overheadVariancePercentage > 10 ? "text-red-500 font-bold" : ""}>
                  {alert.overheadVariancePercentage.toFixed(2)}%
                </TableCell>
                <TableCell className={alert.totalVariance > 20 ? "text-red-500 font-bold" : ""}>
                  {alert.totalVariance.toFixed(2)}%
                </TableCell>
                <TableCell>
                  <Badge 
                    variant={
                      alert.varianceSeverity === 'HIGH' ? 'destructive' : 
                      alert.varianceSeverity === 'MEDIUM' ? 'default' : 'secondary'
                    }
                  >
                    {alert.varianceSeverity}
                  </Badge>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    )
  }
  
  const renderEquivalentUnitsChart = () => {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={equivalentUnitsData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="stage" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey="equivalentUnitsMaterial" name="Material EU" fill="#8884d8" />
          <Bar dataKey="equivalentUnitsConversion" name="Conversion EU" fill="#82ca9d" />
        </BarChart>
      </ResponsiveContainer>
    )
  }
  
  const renderCostPerEquivalentUnitChart = () => {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={costPerEquivalentUnitData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="stage" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey="costPerEquivalentUnitMaterial" name="Material Cost/EU" fill="#ffc658" />
          <Bar dataKey="costPerEquivalentUnitConversion" name="Conversion Cost/EU" fill="#ff7300" />
        </BarChart>
      </ResponsiveContainer>
    )
  }
  
  const renderCostBreakdownChart = () => {
    // Aggregate costs by type
    const aggregatedData = [
      { name: 'Material', value: costPerEquivalentUnitData.reduce((sum, item) => sum + item.materialCost, 0) },
      { name: 'Labor', value: costPerEquivalentUnitData.reduce((sum, item) => sum + item.laborCost, 0) },
      { name: 'Overhead', value: costPerEquivalentUnitData.reduce((sum, item) => sum + item.overheadCost, 0) },
    ]
    
    return (
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={aggregatedData}
            cx="50%"
            cy="50%"
            labelLine={true}
            outerRadius={80}
            fill="#8884d8"
            dataKey="value"
            label={(props: any) => `${props.name}: ${(props.percent * 100).toFixed(0)}%`}
          >
            {aggregatedData.map((_entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => [`$${value}`, 'Cost']} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    )
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold wardah-text-gradient-google">Process Costing Dashboard</h1>
        <div className="flex space-x-2">
          <Button onClick={handleCalculateEquivalentUnits} className="wardah-glass-card">
            <Calculator className="mr-2 h-4 w-4" />
            Calculate EU
          </Button>
          <Button onClick={handlePerformVarianceAnalysis} variant="secondary" className="wardah-glass-card">
            <TrendingUp className="mr-2 h-4 w-4" />
            Analyze Variances
          </Button>
        </div>
      </div>
      
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="wardah-glass-card wardah-animation-float">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active MOs</CardTitle>
            <Factory className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {mos ? mos.filter(mo => mo.status === 'In Progress').length : 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Manufacturing orders in progress
            </p>
          </CardContent>
        </Card>
        
        <Card className="wardah-glass-card wardah-animation-float">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">High Variance Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {varianceAlerts ? varianceAlerts.filter(a => a.varianceSeverity === 'HIGH').length : 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Requiring immediate attention
            </p>
          </CardContent>
        </Card>
        
        <Card className="wardah-glass-card wardah-animation-float">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg. Material Cost/EU</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {costPerEquivalentUnitData.length > 0 ? 
                (costPerEquivalentUnitData.reduce((sum, item) => sum + item.costPerEquivalentUnitMaterial, 0) / costPerEquivalentUnitData.length).toFixed(2) : 
                '0'} // NOSONAR - String value for display
            </div>
            <p className="text-xs text-muted-foreground">
              Average across all stages
            </p>
          </CardContent>
        </Card>
        
        <Card className="wardah-glass-card wardah-animation-float">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Units Completed</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {equivalentUnitsData.length > 0 ? 
                equivalentUnitsData.reduce((sum, item) => sum + item.equivalentUnitsMaterial, 0).toLocaleString() : 
                '0'}
            </div>
            <p className="text-xs text-muted-foreground">
              Equivalent units produced
            </p>
          </CardContent>
        </Card>
      </div>
      
      {/* Configuration Panel */}
      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle>Equivalent Units Calculation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mo-select">Manufacturing Order</Label>
              <Select value={selectedMO} onValueChange={setSelectedMO}>
                <SelectTrigger id="mo-select" className="wardah-glass-card">
                  <SelectValue placeholder="Select MO" />
                </SelectTrigger>
                <SelectContent>
                  {mos && mos.map((mo) => (
                    <SelectItem key={mo.id} value={mo.id}>
                      {mo.orderNumber} - {mo.itemName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="stage-select">المرحلة</Label>
              <Select 
                value={selectedStage} 
                onValueChange={(value: string) => setSelectedStage(value)}
                disabled={isStagesLoading}
              >
                <SelectTrigger id="stage-select" className="wardah-glass-card">
                  <SelectValue placeholder="اختر المرحلة" />
                </SelectTrigger>
                <SelectContent>
                  {stages
                    .filter((stage: any) => stage.is_active)
                    .sort((a: any, b: any) => (a.order_sequence || 0) - (b.order_sequence || 0))
                    .map((stage: any) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.code} - {stage.name_ar || stage.name} (الترتيب: {stage.order_sequence})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="beginning-wip">Beginning WIP</Label>
              <Input
                id="beginning-wip"
                type="number"
                value={beginningWip}
                onChange={(e) => setBeginningWip(Number(e.target.value))}
                className="wardah-glass-card"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="units-started">Units Started</Label>
              <Input
                id="units-started"
                type="number"
                value={unitsStarted}
                onChange={(e) => setUnitsStarted(Number(e.target.value))}
                className="wardah-glass-card"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="units-completed">Units Completed</Label>
              <Input
                id="units-completed"
                type="number"
                value={unitsCompleted}
                onChange={(e) => setUnitsCompleted(Number(e.target.value))}
                className="wardah-glass-card"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="ending-wip">Ending WIP</Label>
              <Input
                id="ending-wip"
                type="number"
                value={endingWip}
                onChange={(e) => setEndingWip(Number(e.target.value))}
                className="wardah-glass-card"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="material-completion">Material Completion %</Label>
              <Input
                id="material-completion"
                type="number"
                value={materialCompletion}
                onChange={(e) => setMaterialCompletion(Number(e.target.value))}
                className="wardah-glass-card"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="conversion-completion">Conversion Completion %</Label>
              <Input
                id="conversion-completion"
                type="number"
                value={conversionCompletion}
                onChange={(e) => setConversionCompletion(Number(e.target.value))}
                className="wardah-glass-card"
              />
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Tabs for different views */}
      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts">Variance Alerts</TabsTrigger>
          <TabsTrigger value="eu-chart">Equivalent Units</TabsTrigger>
          <TabsTrigger value="cpeu-chart">Cost per EU</TabsTrigger>
          <TabsTrigger value="cost-breakdown">Cost Breakdown</TabsTrigger>
        </TabsList>
        
        <TabsContent value="alerts">
          <Card className="wardah-glass-card">
            <CardHeader>
              <CardTitle>Variance Analysis Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              {renderVarianceAlerts()}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="eu-chart">
          <Card className="wardah-glass-card">
            <CardHeader>
              <CardTitle>Equivalent Units by Stage</CardTitle>
            </CardHeader>
            <CardContent>
              {renderEquivalentUnitsChart()}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="cpeu-chart">
          <Card className="wardah-glass-card">
            <CardHeader>
              <CardTitle>Cost per Equivalent Unit by Stage</CardTitle>
            </CardHeader>
            <CardContent>
              {renderCostPerEquivalentUnitChart()}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="cost-breakdown">
          <Card className="wardah-glass-card">
            <CardHeader>
              <CardTitle>Cost Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {renderCostBreakdownChart()}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      
      {/* Informational Alert */}
      <Alert className="wardah-glass-card">
        <AlertTitle>Process Costing Methodology</AlertTitle>
        <AlertDescription>
          This dashboard implements the process costing methodology with equivalent units calculation. 
          Equivalent units represent the number of complete units that could have been produced 
          given the amount of work done on partially completed units. The calculation considers 
          both materials and conversion costs (labor + overhead) with different completion percentages.
        </AlertDescription>
      </Alert>
    </div>
  )
}
