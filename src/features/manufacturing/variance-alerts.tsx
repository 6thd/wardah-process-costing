/**
 * Variance Alerts Component
 * Real-time monitoring of cost variances with alert notifications
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from '@/components/ui/table'
import { 
  AlertTriangle, Bell, CheckCircle, 
  TrendingUp, Filter, RefreshCw
} from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

// Types
interface VarianceAlert {
  id: string
  moId: string
  moNumber: string
  itemId: string
  itemName: string
  stageNo: number
  stageName: string
  varianceDate: string
  materialVariance: number
  materialVariancePercent: number
  laborVariance: number
  laborVariancePercent: number
  overheadVariance: number
  overheadVariancePercent: number
  totalVariance: number
  totalVariancePercent: number
  varianceSeverity: 'LOW' | 'MEDIUM' | 'HIGH'
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
  assignedTo?: string
  createdAt: string
  updatedAt: string
}

// Mock data for demonstration
const mockVarianceAlerts: VarianceAlert[] = [
  {
    id: 'alert-1',
    moId: 'mo-1',
    moNumber: 'MO-2023-001',
    itemId: 'item-1',
    itemName: 'Plastic Bottles 500ml',
    stageNo: 10,
    stageName: 'Rolling Stage',
    varianceDate: '2023-06-15',
    materialVariance: 500,
    materialVariancePercent: 10.0,
    laborVariance: 140,
    laborVariancePercent: 7.0,
    overheadVariance: 105,
    overheadVariancePercent: 7.0,
    totalVariance: 745,
    totalVariancePercent: 8.1,
    varianceSeverity: 'HIGH',
    status: 'OPEN',
    assignedTo: 'Ahmed Khalid',
    createdAt: '2023-06-15T10:30:00Z',
    updatedAt: '2023-06-15T10:30:00Z'
  },
  {
    id: 'alert-2',
    moId: 'mo-2',
    moNumber: 'MO-2023-002',
    itemId: 'item-2',
    itemName: 'Plastic Caps',
    stageNo: 50,
    stageName: 'Regrind Processing',
    varianceDate: '2023-06-14',
    materialVariance: 0,
    materialVariancePercent: 0,
    laborVariance: 120,
    laborVariancePercent: 6.67,
    overheadVariance: 90,
    overheadVariancePercent: 6.67,
    totalVariance: 210,
    totalVariancePercent: 6.67,
    varianceSeverity: 'MEDIUM',
    status: 'ACKNOWLEDGED',
    assignedTo: 'Fatima Al-Zahra',
    createdAt: '2023-06-14T14:15:00Z',
    updatedAt: '2023-06-15T09:00:00Z'
  },
  {
    id: 'alert-3',
    moId: 'mo-1',
    moNumber: 'MO-2023-001',
    itemId: 'item-1',
    itemName: 'Plastic Bottles 500ml',
    stageNo: 20,
    stageName: 'Transparency Processing',
    varianceDate: '2023-06-10',
    materialVariance: 0,
    materialVariancePercent: 0,
    laborVariance: -50,
    laborVariancePercent: -2.5,
    overheadVariance: -30,
    overheadVariancePercent: -2.0,
    totalVariance: -80,
    totalVariancePercent: -2.2,
    varianceSeverity: 'LOW',
    status: 'RESOLVED',
    assignedTo: 'Mohammed Ali',
    createdAt: '2023-06-10T08:45:00Z',
    updatedAt: '2023-06-12T16:30:00Z'
  },
  {
    id: 'alert-4',
    moId: 'mo-3',
    moNumber: 'MO-2023-003',
    itemId: 'item-3',
    itemName: 'Label Stickers',
    stageNo: 10,
    stageName: 'Rolling Stage',
    varianceDate: '2023-06-16',
    materialVariance: 320,
    materialVariancePercent: 8.0,
    laborVariance: 85,
    laborVariancePercent: 5.3,
    overheadVariance: 65,
    overheadVariancePercent: 5.1,
    totalVariance: 470,
    totalVariancePercent: 6.2,
    varianceSeverity: 'MEDIUM',
    status: 'OPEN',
    createdAt: '2023-06-16T11:20:00Z',
    updatedAt: '2023-06-16T11:20:00Z'
  }
]

export function VarianceAlerts() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  
  // State
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'LOW' | 'MEDIUM' | 'HIGH'>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'>('ALL')
  const [searchTerm, setSearchTerm] = useState('')
  
  // Queries
  const { data: alerts = mockVarianceAlerts, isLoading, refetch } = useQuery({
    queryKey: ['variance-alerts'],
    queryFn: async () => {
      try {
        // In a real implementation:
        // return await equivalentUnitsService.getVarianceAlerts()
        return mockVarianceAlerts
      } catch (error) {
        toast({
          title: "Error loading variance alerts",
          description: "Failed to load variance alerts. Showing mock data.",
          variant: "destructive"
        })
        return mockVarianceAlerts
      }
    },
    refetchInterval: 30000 // Refetch every 30 seconds
  })
  
  // Filter alerts based on filters and search term
  const filteredAlerts = alerts.filter(alert => {
    // Severity filter
    if (severityFilter !== 'ALL' && alert.varianceSeverity !== severityFilter) {
      return false
    }
    
    // Status filter
    if (statusFilter !== 'ALL' && alert.status !== statusFilter) {
      return false
    }
    
    // Search term filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      return (
        alert.moNumber.toLowerCase().includes(term) ||
        alert.itemName.toLowerCase().includes(term) ||
        alert.stageName.toLowerCase().includes(term)
      )
    }
    
    return true
  })
  
  // Handlers
  const handleAcknowledgeAlert = async () => {
    try {
      // In a real implementation:
      // await equivalentUnitsService.updateAlertStatus(alertId, 'ACKNOWLEDGED')
      
      toast({
        title: "Alert Acknowledged",
        description: "Variance alert has been acknowledged"
      })
      
      queryClient.invalidateQueries({ queryKey: ['variance-alerts'] })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to acknowledge alert",
        variant: "destructive"
      })
    }
  }
  
  const handleResolveAlert = async () => {
    try {
      // In a real implementation:
      // await equivalentUnitsService.updateAlertStatus(alertId, 'RESOLVED')
      
      toast({
        title: "Alert Resolved",
        description: "Variance alert has been marked as resolved"
      })
      
      queryClient.invalidateQueries({ queryKey: ['variance-alerts'] })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to resolve alert",
        variant: "destructive"
      })
    }
  }
  
  const handleSnoozeAlert = async () => {
    try {
      // In a real implementation:
      // await equivalentUnitsService.snoozeAlert(alertId, 24) // Snooze for 24 hours
      
      toast({
        title: "Alert Snoozed",
        description: "Variance alert has been snoozed for 24 hours"
      })
      
      queryClient.invalidateQueries({ queryKey: ['variance-alerts'] })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to snooze alert",
        variant: "destructive"
      })
    }
  }
  
  // Render functions
  const renderAlertStatus = (status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED') => {
    switch (status) {
      case 'OPEN':
        return <Badge variant="destructive">Open</Badge>
      case 'ACKNOWLEDGED':
        return <Badge variant="default">Acknowledged</Badge>
      case 'RESOLVED':
        return <Badge variant="secondary">Resolved</Badge>
      default:
        return <Badge variant="outline">Unknown</Badge>
    }
  }
  
  const renderSeverityBadge = (severity: 'LOW' | 'MEDIUM' | 'HIGH') => {
    switch (severity) {
      case 'LOW':
        return <Badge variant="secondary">Low</Badge>
      case 'MEDIUM':
        return <Badge variant="default">Medium</Badge>
      case 'HIGH':
        return <Badge variant="destructive">High</Badge>
      default:
        return <Badge variant="outline">Unknown</Badge>
    }
  }
  
  const renderVarianceValue = (value: number, percent: number) => {
    const isPositive = value > 0
    const isSignificant = Math.abs(percent) > 5
    
    return (
      <div className="flex flex-col">
        <span className={isPositive ? "text-red-500" : "text-green-500"}>
          {isPositive ? '+' : ''}{value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span className={`text-xs ${isSignificant ? (isPositive ? "text-red-500" : "text-green-500") : "text-muted-foreground"}`}>
          {isPositive ? '+' : ''}{percent.toFixed(2)}%
        </span>
      </div>
    )
  }
  
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold wardah-text-gradient-google">Variance Alerts</h1>
          <p className="text-muted-foreground">
            Monitor cost variances and take corrective actions
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => refetch()} disabled={isLoading} className="wardah-glass-card">
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>
      
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="wardah-glass-card wardah-animation-float">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Alerts</p>
                <p className="text-2xl font-bold">{alerts.length}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="wardah-glass-card wardah-animation-float">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">High Severity</p>
                <p className="text-2xl font-bold text-red-500">
                  {alerts.filter(a => a.varianceSeverity === 'HIGH').length}
                </p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="wardah-glass-card wardah-animation-float">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Open Alerts</p>
                <p className="text-2xl font-bold">
                  {alerts.filter(a => a.status === 'OPEN').length}
                </p>
              </div>
              <Bell className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="wardah-glass-card wardah-animation-float">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg. Variance</p>
                <p className="text-2xl font-bold">
                  {alerts.length > 0 
                    ? `${(alerts.reduce((sum, a) => sum + a.totalVariancePercent, 0) / alerts.length).toFixed(2)}%` 
                    : '0%'}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Filters */}
      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 wardah-text-gradient-google">
            <Filter className="h-5 w-5" />
            Filter Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label htmlFor="severity-filter" className="text-sm font-medium">Severity</label>
              <div id="severity-filter" className="flex flex-wrap gap-2 mt-2">
                <Button
                  variant={severityFilter === 'ALL' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSeverityFilter('ALL')}
                  className="wardah-glass-card"
                >
                  All
                </Button>
                <Button
                  variant={severityFilter === 'HIGH' ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={() => setSeverityFilter('HIGH')}
                  className="wardah-glass-card"
                >
                  High
                </Button>
                <Button
                  variant={severityFilter === 'MEDIUM' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSeverityFilter('MEDIUM')}
                  className="wardah-glass-card"
                >
                  Medium
                </Button>
                <Button
                  variant={severityFilter === 'LOW' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setSeverityFilter('LOW')}
                  className="wardah-glass-card"
                >
                  Low
                </Button>
              </div>
            </div>
            
            <div>
              <label htmlFor="status-filter" className="text-sm font-medium">Status</label>
              <div id="status-filter" className="flex flex-wrap gap-2 mt-2">
                <Button
                  variant={statusFilter === 'ALL' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatusFilter('ALL')}
                  className="wardah-glass-card"
                >
                  All
                </Button>
                <Button
                  variant={statusFilter === 'OPEN' ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={() => setStatusFilter('OPEN')}
                  className="wardah-glass-card"
                >
                  Open
                </Button>
                <Button
                  variant={statusFilter === 'ACKNOWLEDGED' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatusFilter('ACKNOWLEDGED')}
                  className="wardah-glass-card"
                >
                  Acknowledged
                </Button>
                <Button
                  variant={statusFilter === 'RESOLVED' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setStatusFilter('RESOLVED')}
                  className="wardah-glass-card"
                >
                  Resolved
                </Button>
              </div>
            </div>
            
            <div className="md:col-span-2">
              <label htmlFor="variance-search" className="text-sm font-medium">Search</label>
              <div className="mt-2">
                <input
                  id="variance-search"
                  type="text"
                  placeholder="Search by MO, item, or stage..."
                  className="w-full px-3 py-2 border rounded-md wardah-glass-card"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Alerts Table */}
      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle className="wardah-text-gradient-google">Variance Alerts</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center h-32">
              <RefreshCw className="h-6 w-6 animate-spin" />
              <span className="ml-2">Loading alerts...</span>
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
              <h3 className="mt-2 text-lg font-medium">No alerts found</h3>
              <p className="mt-1 text-muted-foreground">
                No variance alerts match your current filters.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>MO / Item</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Labor</TableHead>
                  <TableHead>Overhead</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAlerts.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <div className="font-medium">{alert.moNumber}</div>
                      <div className="text-sm text-muted-foreground">{alert.itemName}</div>
                    </TableCell>
                    <TableCell>
                      <div>Stage {alert.stageNo}</div>
                      <div className="text-sm text-muted-foreground">{alert.stageName}</div>
                    </TableCell>
                    <TableCell>{new Date(alert.varianceDate).toLocaleDateString()}</TableCell>
                    <TableCell>{renderVarianceValue(alert.materialVariance, alert.materialVariancePercent)}</TableCell>
                    <TableCell>{renderVarianceValue(alert.laborVariance, alert.laborVariancePercent)}</TableCell>
                    <TableCell>{renderVarianceValue(alert.overheadVariance, alert.overheadVariancePercent)}</TableCell>
                    <TableCell>
                      <div className={alert.totalVariance > 0 ? "text-red-500" : "text-green-500"}>
                        {alert.totalVariance > 0 ? '+' : ''}{alert.totalVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className={`text-xs ${Math.abs(alert.totalVariancePercent) > 5 ? (alert.totalVariance > 0 ? "text-red-500" : "text-green-500") : "text-muted-foreground"}`}>
                        {alert.totalVariance > 0 ? '+' : ''}{alert.totalVariancePercent.toFixed(2)}%
                      </div>
                    </TableCell>
                    <TableCell>{renderSeverityBadge(alert.varianceSeverity)}</TableCell>
                    <TableCell>{renderAlertStatus(alert.status)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {alert.status === 'OPEN' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAcknowledgeAlert()}
                            className="wardah-glass-card"
                          >
                            Acknowledge
                          </Button>
                        )}
                        {alert.status !== 'RESOLVED' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleResolveAlert()}
                            className="wardah-glass-card"
                          >
                            Resolve
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSnoozeAlert()}
                          className="wardah-glass-card"
                        >
                          Snooze
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      
      {/* Informational Alert */}
      <Alert className="wardah-glass-card">
        <AlertTitle>Variance Monitoring</AlertTitle>
        <AlertDescription>
          This system monitors cost variances in real-time and generates alerts when variances exceed 
          predefined thresholds. High severity alerts (variance {'>'} 10%) require immediate attention, 
          while medium severity alerts (variance {'>'} 5%) should be reviewed within 24 hours.
        </AlertDescription>
      </Alert>
    </div>
  )
}
