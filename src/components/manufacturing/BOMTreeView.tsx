/**
 * BOM Tree Visualization Component
 * مكون عرض شجرة BOM متعددة المستويات
 */

import { useState, useEffect, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { 
  ChevronRight, 
  ChevronDown, 
  Package, 
  DollarSign,
  AlertTriangle,
  Search,
  RefreshCw,
  Download
} from 'lucide-react'
import { bomTreeService, BOMTreeNode } from '@/services/manufacturing/bomTreeService'
import { toast } from 'sonner'

interface BOMTreeViewProps {
  bomId: string
  quantity?: number
  onNodeSelect?: (node: BOMTreeNode) => void
  showCosts?: boolean
  showSearch?: boolean
}

export function BOMTreeView({
  bomId,
  quantity = 1,
  onNodeSelect,
  showCosts = true,
  showSearch = true
}: BOMTreeViewProps) {
  const [tree, setTree] = useState<BOMTreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [totalCost, setTotalCost] = useState(0)

  // تحميل الشجرة
  const loadTree = async (forceRebuild = false) => {
    setLoading(true)
    try {
      const treeData = await bomTreeService.buildBOMTree(bomId, quantity, forceRebuild)
      setTree(treeData)
      setTotalCost(bomTreeService.calculateTreeCost(treeData))
      
      // توسيع الجذر افتراضياً
      if (treeData.length > 0) {
        setExpandedNodes(new Set([treeData[0].id]))
      }
    } catch (error: any) {
      toast.error(`خطأ في تحميل الشجرة: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (bomId) {
      loadTree()
    }
  }, [bomId, quantity])

  // تصفية الشجرة حسب البحث
  const filteredTree = useMemo(() => {
    if (!searchTerm) return tree

    const searchResults = bomTreeService.searchInTree(tree, searchTerm)
    const resultIds = new Set(searchResults.map(r => r.id))
    
    // إرجاع الشجرة مع تمييز النتائج
    const filterTree = (nodes: BOMTreeNode[]): BOMTreeNode[] => {
      return nodes.map(node => {
        const matches = resultIds.has(node.id)
        const filteredChildren = node.children ? filterTree(node.children) : []
        const hasMatchingChild = filteredChildren.length > 0

        if (matches || hasMatchingChild) {
          return {
            ...node,
            children: filteredChildren.length > 0 ? filteredChildren : node.children
          }
        }
        return null
      }).filter(Boolean) as BOMTreeNode[]
    }

    return filterTree(tree)
  }, [tree, searchTerm])

  // تبديل توسيع/طي عقدة
  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId)
    } else {
      newExpanded.add(nodeId)
    }
    setExpandedNodes(newExpanded)
  }

  // اختيار عقدة
  const handleNodeSelect = (node: BOMTreeNode) => {
    setSelectedNode(node.id)
    if (onNodeSelect) {
      onNodeSelect(node)
    }
  }

  // مكون عقدة الشجرة
  const TreeNode = ({ node, level = 0 }: { node: BOMTreeNode; level?: number }) => {
    const isExpanded = expandedNodes.has(node.id)
    const isSelected = selectedNode === node.id
    const hasChildren = node.children && node.children.length > 0

    return (
      <div className="select-none">
        <div
          className={`
            flex items-center gap-2 p-2 rounded-lg cursor-pointer
            hover:bg-accent transition-colors
            ${isSelected ? 'bg-accent border-l-2 border-primary' : ''}
          `}
          style={{ paddingLeft: `${level * 24 + 8}px` }}
          onClick={() => handleNodeSelect(node)}
        >
          {/* أيقونة التوسيع */}
          <div className="w-6 flex items-center justify-center">
            {hasChildren ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleNode(node.id)
                }}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            ) : (
              <div className="w-6" />
            )}
          </div>

          {/* أيقونة الصنف */}
          <Package className="h-4 w-4 text-muted-foreground" />

          {/* معلومات الصنف */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">
                {node.item_code}
              </span>
              <span className="text-sm text-muted-foreground truncate">
                {node.item_name}
              </span>
              {node.is_critical && (
                <Badge variant="destructive" className="text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  حرج
                </Badge>
              )}
              {node.line_type === 'PHANTOM' && (
                <Badge variant="outline" className="text-xs">
                  Phantom
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
              <span>الكمية: {node.quantity_required.toFixed(4)}</span>
              {node.scrap_factor > 0 && (
                <span>هالك: {node.scrap_factor}%</span>
              )}
              {showCosts && (
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  {node.total_cost.toFixed(2)} ريال
                </span>
              )}
            </div>
          </div>
        </div>

        {/* العقد الفرعية */}
        {hasChildren && isExpanded && (
          <div>
            {node.children!.map(child => (
              <TreeNode key={child.id} node={child} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            شجرة قائمة المواد
          </CardTitle>
          <div className="flex items-center gap-2">
            {showCosts && (
              <Badge variant="secondary" className="text-lg">
                <DollarSign className="h-4 w-4 mr-1" />
                {totalCost.toFixed(2)} ريال
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadTree(true)}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              تحديث
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* شريط البحث */}
        {showSearch && (
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ابحث في الشجرة..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pr-10"
              />
            </div>
          </div>
        )}

        {/* الشجرة */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredTree.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            لا توجد بيانات
          </div>
        ) : (
          <div className="border rounded-lg overflow-auto max-h-[600px]">
            {filteredTree.map(node => (
              <TreeNode key={node.id} node={node} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

