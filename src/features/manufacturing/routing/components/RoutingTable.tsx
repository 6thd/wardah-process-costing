/**
 * Routing Table Component
 * مكون جدول المسارات
 */

import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Edit, Trash2, Copy, CheckCircle } from 'lucide-react'
import type { Routing } from '@/services/manufacturing/routingService'

interface RoutingTableProps {
  routings: Routing[]
  isRTL: boolean
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onCopy: (id: string, code: string) => void
  onApprove: (id: string) => void
  getStatusBadge: (status: string, isActive: boolean) => React.ReactNode
}

export const RoutingTable: React.FC<RoutingTableProps> = ({
  routings,
  isRTL,
  onEdit,
  onDelete,
  onCopy,
  onApprove,
  getStatusBadge
}) => {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{isRTL ? 'رمز المسار' : 'Routing Code'}</TableHead>
          <TableHead>{isRTL ? 'الاسم' : 'Name'}</TableHead>
          <TableHead>{isRTL ? 'الإصدار' : 'Version'}</TableHead>
          <TableHead>{isRTL ? 'الحالة' : 'Status'}</TableHead>
          <TableHead>{isRTL ? 'تاريخ الفعالية' : 'Effective Date'}</TableHead>
          <TableHead className="text-center">{isRTL ? 'الإجراءات' : 'Actions'}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {routings.map((routing) => (
          <TableRow
            key={routing.id}
            className="cursor-pointer hover:bg-muted/50"
            onClick={() => {
              // Handle view navigation if needed
            }}
          >
            <TableCell className="font-medium">{routing.routing_code}</TableCell>
            <TableCell>
              {isRTL ? (routing.routing_name_ar || routing.routing_name) : routing.routing_name}
            </TableCell>
            <TableCell>
              <Badge variant="outline">v{routing.version}</Badge>
            </TableCell>
            <TableCell>{getStatusBadge(routing.status, routing.is_active)}</TableCell>
            <TableCell>
              {new Date(routing.effective_date).toLocaleDateString(isRTL ? 'ar-SA' : 'en-US')}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    onEdit(routing.id)
                  }}
                >
                  <Edit className="w-4 h-4" />
                </Button>
                
                {routing.status === 'DRAFT' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      onApprove(routing.id)
                    }}
                    className="text-green-600"
                  >
                    <CheckCircle className="w-4 h-4" />
                  </Button>
                )}
                
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCopy(routing.id, routing.routing_code)
                  }}
                >
                  <Copy className="w-4 h-4" />
                </Button>
                
                {routing.status === 'DRAFT' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(routing.id)
                    }}
                    className="text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

