from pathlib import Path

path = Path('src/features/inventory/index.tsx')
text = path.read_text()

import_anchor = "import { UomStatusBadge } from './components/UomStatusBadge'\n"
import_line = "import { InventoryKeyMetrics, InventoryQuickActions, LowStockAlert } from './components/InventoryOverviewSections'\n"
assert text.count(import_anchor) == 1, 'unexpected UomStatusBadge import count'
assert import_line not in text, 'overview sections import already present'
text = text.replace(import_anchor, import_anchor + import_line, 1)

metrics_start = text.index('      {/* Key Metrics — مشتقة كلها من items، فتُعرض فقط بمفتاح قراءتها */}')
low_stock_start = text.index('      {/* Low Stock Alert — مشتقة من items أيضًا */}', metrics_start)

middle = '''      {/* Key Metrics — مشتقة كلها من items، فتُعرض فقط بمفتاح قراءتها */}
      {canReadItems && (
        <InventoryKeyMetrics
          items={items}
          totalValue={totalValue}
          lowStockCount={lowStockItems.length}
        />
      )}

      {/* Quick Actions — كل رابط يُعرض فقط بمفتاح دخول مساره في العقد */}
      <InventoryQuickActions
        canReadItems={canReadItems}
        canReadStockMoves={canReadStockMoves}
        canReadWarehouses={canReadWarehouses}
        canReadAdjustments={canReadAdjustments}
        t={t}
        isRTL={isRTL}
      />

'''
text = text[:metrics_start] + middle + text[low_stock_start:]

low_stock_start = text.index('      {/* Low Stock Alert — مشتقة من items أيضًا */}', metrics_start)
overview_end = text.index('    </div>\n  )\n}\n\nfunction ItemsManagement()', low_stock_start)
low_stock = '''      {/* Low Stock Alert — مشتقة من items أيضًا */}
      {canReadItems && lowStockItems.length > 0 && (
        <LowStockAlert lowStockItems={lowStockItems} />
      )}
'''
text = text[:low_stock_start] + low_stock + text[overview_end:]

assert text.count('<InventoryKeyMetrics') == 1
assert text.count('<InventoryQuickActions') == 1
assert text.count('<LowStockAlert') == 1
assert text.count('itemsService.getAll()') >= 2, 'unexpected fetch-path mutation'
assert '  }, [canReadItems])' in text, 'InventoryOverview effect dependency changed'

path.write_text(text)
