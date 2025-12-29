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
          <TableHead>{isRTL ? 'كود المسار' : 'Routing Code'}</TableHead>
          <TableHead>{isRTL ? 'اسم المسار' : 'Routing Name'}</TableHead>
          <TableHead>{isRTL ? 'الإصدار' : 'Version'}</TableHead>
          <TableHead>{isRTL ? 'الحالة' : 'Status'}</TableHead>
          <TableHead>{isRTL ? 'نشط' : 'Active'}</TableHead>
          <TableHead className="text-right">{isRTL ? 'الإجراءات' : 'Actions'}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {routings.map((routing) => (
          <TableRow key={routing.id}>
            <TableCell className="font-mono">{routing.routing_code}</TableCell>
            <TableCell>
              {isRTL ? routing.routing_name_ar || routing.routing_name : routing.routing_name}
            </TableCell>
            <TableCell>{routing.version}</TableCell>
            <TableCell>{getStatusBadge(routing.status, routing.is_active)}</TableCell>
            <TableCell>
              <Badge variant={routing.is_active ? 'default' : 'secondary'}>
                {routing.is_active ? (isRTL ? 'نعم' : 'Yes') : (isRTL ? 'لا' : 'No')}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(routing.id)}
                >
                  <Edit className="w-4 h-4" />
                </Button>
                {routing.status === 'DRAFT' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onApprove(routing.id)}
                  >
                    <CheckCircle className="w-4 h-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onCopy(routing.id, routing.routing_code)}
                >
                  <Copy className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(routing.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

