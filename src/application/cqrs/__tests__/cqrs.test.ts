/**
 * @fileoverview CQRS Tests
 * @description اختبارات نمط CQRS (Command Query Responsibility Segregation)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Command Bus
  CommandBus,
  getCommandBus,
  resetCommandBus,
  LoggingMiddleware,
  ValidationMiddleware,
  // Query Bus
  QueryBus,
  getQueryBus,
  resetQueryBus,
  InMemoryQueryCache,
  QueryLoggingMiddleware,
  PerformanceMiddleware,
  // Commands
  createAdjustStockCommand,
  createTransferStockCommand,
  createCreateProductCommand,
  createCreateJournalEntryCommand,
  createPostJournalEntryCommand,
  InventoryCommandTypes,
  AccountingCommandTypes,
  // Queries
  createGetProductQuery,
  createGetProductsQuery,
  createGetStockBalanceQuery,
  createGetTrialBalanceQuery,
  createGetDashboardMetricsQuery,
  InventoryQueryTypes,
  AccountingQueryTypes,
  // Types
  type ICommand,
  type ICommandHandler,
  type IQuery,
  type IQueryHandler,
  type CommandResult,
  type QueryResult
} from '@/application/cqrs'

describe('CQRS Pattern', () => {
  describe('Commands', () => {
    describe('Inventory Commands', () => {
      it('should create adjust stock command', () => {
        const command = createAdjustStockCommand({
          productId: 'prod-1',
          warehouseId: 'wh-1',
          quantity: 50,
          reason: 'تعديل المخزون',
          userId: 'user-1',
          organizationId: 'org-1'
        })

        expect(command.commandType).toBe(InventoryCommandTypes.ADJUST_STOCK)
        expect(command.productId).toBe('prod-1')
        expect(command.quantity).toBe(50)
        expect(command.timestamp).toBeInstanceOf(Date)
      })

      it('should create transfer stock command', () => {
        const command = createTransferStockCommand({
          productId: 'prod-1',
          fromWarehouseId: 'wh-1',
          toWarehouseId: 'wh-2',
          quantity: 25,
          userId: 'user-1'
        })

        expect(command.commandType).toBe(InventoryCommandTypes.TRANSFER_STOCK)
        expect(command.fromWarehouseId).toBe('wh-1')
        expect(command.toWarehouseId).toBe('wh-2')
      })

      it('should create product command', () => {
        const command = createCreateProductCommand({
          code: 'PROD001',
          name: 'منتج جديد',
          nameEn: 'New Product',
          unitOfMeasure: 'قطعة',
          standardCost: 100,
          sellingPrice: 150
        })

        expect(command.commandType).toBe(InventoryCommandTypes.CREATE_PRODUCT)
        expect(command.code).toBe('PROD001')
        expect(command.standardCost).toBe(100)
      })
    })

    describe('Accounting Commands', () => {
      it('should create journal entry command', () => {
        const command = createCreateJournalEntryCommand({
          date: new Date('2025-01-15'),
          description: 'قيد مبيعات نقدية',
          lines: [
            { accountId: 'acc-1', debit: 1000, credit: 0 },
            { accountId: 'acc-2', debit: 0, credit: 1000 }
          ],
          userId: 'accountant-1',
          organizationId: 'org-1'
        })

        expect(command.commandType).toBe(AccountingCommandTypes.CREATE_JOURNAL_ENTRY)
        expect(command.lines).toHaveLength(2)
        expect(command.description).toBe('قيد مبيعات نقدية')
      })

      it('should create post journal entry command', () => {
        const command = createPostJournalEntryCommand({
          entryId: 'je-1',
          userId: 'manager-1'
        })

        expect(command.commandType).toBe(AccountingCommandTypes.POST_JOURNAL_ENTRY)
        expect(command.entryId).toBe('je-1')
      })
    })
  })

  describe('Queries', () => {
    describe('Inventory Queries', () => {
      it('should create get product query', () => {
        const query = createGetProductQuery({
          productId: 'prod-1',
          includeStock: true,
          includeMovements: true,
          organizationId: 'org-1'
        })

        expect(query.queryType).toBe(InventoryQueryTypes.GET_PRODUCT)
        expect(query.productId).toBe('prod-1')
        expect(query.includeStock).toBe(true)
      })

      it('should create get products query with filters', () => {
        const query = createGetProductsQuery({
          pagination: { page: 1, pageSize: 20 },
          sort: { field: 'name', direction: 'asc' },
          categoryId: 'cat-1',
          isActive: true,
          organizationId: 'org-1'
        })

        expect(query.queryType).toBe(InventoryQueryTypes.GET_PRODUCTS)
        expect(query.pagination?.pageSize).toBe(20)
        expect(query.categoryId).toBe('cat-1')
      })

      it('should create get stock balance query', () => {
        const query = createGetStockBalanceQuery({
          productId: 'prod-1',
          warehouseId: 'wh-1',
          asOfDate: new Date('2025-01-15')
        })

        expect(query.queryType).toBe(InventoryQueryTypes.GET_STOCK_BALANCE)
      })
    })

    describe('Accounting Queries', () => {
      it('should create trial balance query', () => {
        const query = createGetTrialBalanceQuery({
          asOfDate: new Date('2025-01-31'),
          includeZeroBalances: false,
          organizationId: 'org-1'
        })

        expect(query.queryType).toBe(AccountingQueryTypes.GET_TRIAL_BALANCE)
        expect(query.includeZeroBalances).toBe(false)
      })

      it('should create dashboard metrics query', () => {
        const query = createGetDashboardMetricsQuery({
          period: 'month',
          organizationId: 'org-1'
        })

        expect(query.queryType).toBe(AccountingQueryTypes.GET_DASHBOARD_METRICS)
        expect(query.period).toBe('month')
      })
    })
  })

  describe('CommandBus', () => {
    let commandBus: CommandBus

    beforeEach(() => {
      resetCommandBus()
      commandBus = getCommandBus()
    })

    it('should register and dispatch command', async () => {
      const mockHandler: ICommandHandler<ICommand<{ id: string }>, { id: string }> = {
        execute: vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'new-id' }
        })
      }

      commandBus.register(InventoryCommandTypes.ADJUST_STOCK, () => mockHandler)

      const command = createAdjustStockCommand({
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: 50,
        reason: 'تعديل'
      })

      const result = await commandBus.dispatch<{ id: string }>(command)

      expect(result.success).toBe(true)
      expect(result.data?.id).toBe('new-id')
      expect(mockHandler.execute).toHaveBeenCalledWith(command)
    })

    it('should return error for unregistered command', async () => {
      const command = createAdjustStockCommand({
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: 50,
        reason: 'تعديل'
      })

      const result = await commandBus.dispatch(command)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('HANDLER_NOT_FOUND')
    })

    it('should handle execution errors', async () => {
      const mockHandler: ICommandHandler<ICommand<void>, void> = {
        execute: vi.fn().mockRejectedValue(new Error('Database error'))
      }

      commandBus.register(InventoryCommandTypes.ADJUST_STOCK, () => mockHandler)

      const command = createAdjustStockCommand({
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: 50,
        reason: 'تعديل'
      })

      const result = await commandBus.dispatch(command)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('EXECUTION_ERROR')
      expect(result.error?.message).toBe('Database error')
    })

    it('should check if handler exists', () => {
      commandBus.register(InventoryCommandTypes.ADJUST_STOCK, () => ({
        execute: vi.fn().mockResolvedValue({ success: true })
      }))

      expect(commandBus.hasHandler(InventoryCommandTypes.ADJUST_STOCK)).toBe(true)
      expect(commandBus.hasHandler('non.existent')).toBe(false)
    })

    it('should list registered commands', () => {
      commandBus.register(InventoryCommandTypes.ADJUST_STOCK, () => ({
        execute: vi.fn().mockResolvedValue({ success: true })
      }))
      commandBus.register(InventoryCommandTypes.TRANSFER_STOCK, () => ({
        execute: vi.fn().mockResolvedValue({ success: true })
      }))

      const commands = commandBus.getRegisteredCommands()

      expect(commands).toContain(InventoryCommandTypes.ADJUST_STOCK)
      expect(commands).toContain(InventoryCommandTypes.TRANSFER_STOCK)
    })

    describe('Middlewares', () => {
      it('should execute logging middleware', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        
        commandBus.use(new LoggingMiddleware())
        commandBus.register(InventoryCommandTypes.ADJUST_STOCK, () => ({
          execute: vi.fn().mockResolvedValue({ success: true })
        }))

        await commandBus.dispatch(createAdjustStockCommand({
          productId: 'prod-1',
          warehouseId: 'wh-1',
          quantity: 50,
          reason: 'test'
        }))

        expect(logSpy).toHaveBeenCalled()
        logSpy.mockRestore()
      })

      it('should validate command with validation middleware', async () => {
        const validationMiddleware = new ValidationMiddleware()
        validationMiddleware.registerValidator(InventoryCommandTypes.ADJUST_STOCK, (cmd) => {
          const adjustCmd = cmd as ReturnType<typeof createAdjustStockCommand>
          if (adjustCmd.quantity === 0) {
            return { isValid: false, errors: ['الكمية يجب أن تكون أكبر من صفر'] }
          }
          return { isValid: true }
        })

        commandBus.use(validationMiddleware)
        commandBus.register(InventoryCommandTypes.ADJUST_STOCK, () => ({
          execute: vi.fn().mockResolvedValue({ success: true })
        }))

        const result = await commandBus.dispatch(createAdjustStockCommand({
          productId: 'prod-1',
          warehouseId: 'wh-1',
          quantity: 0,
          reason: 'test'
        }))

        expect(result.success).toBe(false)
        expect(result.error?.code).toBe('VALIDATION_ERROR')
      })
    })
  })

  describe('QueryBus', () => {
    let queryBus: QueryBus

    beforeEach(() => {
      resetQueryBus()
      queryBus = getQueryBus()
    })

    it('should register and dispatch query', async () => {
      const mockHandler: IQueryHandler<IQuery<{ name: string }>, { name: string }> = {
        execute: vi.fn().mockResolvedValue({
          success: true,
          data: { name: 'Test Product' }
        })
      }

      queryBus.register(InventoryQueryTypes.GET_PRODUCT, () => mockHandler)

      const query = createGetProductQuery({
        productId: 'prod-1'
      })

      const result = await queryBus.dispatch<{ name: string }>(query)

      expect(result.success).toBe(true)
      expect(result.data?.name).toBe('Test Product')
    })

    it('should return error for unregistered query', async () => {
      const query = createGetProductQuery({ productId: 'prod-1' })
      const result = await queryBus.dispatch(query)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('HANDLER_NOT_FOUND')
    })

    it('should include execution time in metadata', async () => {
      queryBus.register(InventoryQueryTypes.GET_PRODUCT, () => ({
        execute: vi.fn().mockResolvedValue({ success: true, data: {} })
      }))

      const result = await queryBus.dispatch(createGetProductQuery({ productId: 'prod-1' }))

      expect(result.metadata?.executionTime).toBeDefined()
      expect(result.metadata?.cached).toBe(false)
    })

    describe('Caching', () => {
      it('should cache query results', async () => {
        const cache = new InMemoryQueryCache(60000)
        queryBus.enableCache(cache)

        const executeHandler = vi.fn().mockResolvedValue({
          success: true,
          data: { name: 'Cached Product' }
        })

        queryBus.register(InventoryQueryTypes.GET_PRODUCT, () => ({
          execute: executeHandler
        }))

        const query = createGetProductQuery({ productId: 'prod-1' })

        // First call - should execute handler
        await queryBus.dispatch(query)
        expect(executeHandler).toHaveBeenCalledTimes(1)

        // Second call - should use cache
        const cachedResult = await queryBus.dispatch(query)
        expect(executeHandler).toHaveBeenCalledTimes(1) // Still 1
        expect(cachedResult.metadata?.cached).toBe(true)
      })
    })

    describe('Middlewares', () => {
      it('should execute logging middleware', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        queryBus.use(new QueryLoggingMiddleware())
        queryBus.register(InventoryQueryTypes.GET_PRODUCT, () => ({
          execute: vi.fn().mockResolvedValue({ success: true, data: {} })
        }))

        await queryBus.dispatch(createGetProductQuery({ productId: 'prod-1' }))

        expect(logSpy).toHaveBeenCalled()
        logSpy.mockRestore()
      })

      it('should warn for slow queries', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        queryBus.use(new PerformanceMiddleware(-1)) // -1ms threshold - always warn
        queryBus.register(InventoryQueryTypes.GET_PRODUCT, () => ({
          execute: vi.fn().mockImplementation(async () => {
            // إضافة تأخير صغير للتأكد من أن الوقت > 0
            await new Promise(resolve => setTimeout(resolve, 5))
            return { success: true, data: {} }
          })
        }))

        await queryBus.dispatch(createGetProductQuery({ productId: 'prod-1' }))

        expect(warnSpy).toHaveBeenCalled()
        warnSpy.mockRestore()
      })
    })
  })

  describe('InMemoryQueryCache', () => {
    let cache: InMemoryQueryCache

    beforeEach(() => {
      cache = new InMemoryQueryCache(1000) // 1 second TTL
    })

    it('should store and retrieve values', async () => {
      await cache.set('key1', { data: 'test' })
      const result = await cache.get<{ data: string }>('key1')

      expect(result?.data).toBe('test')
    })

    it('should return null for non-existent keys', async () => {
      const result = await cache.get('non-existent')
      expect(result).toBeNull()
    })

    it('should expire entries after TTL', async () => {
      cache = new InMemoryQueryCache(50) // 50ms TTL
      await cache.set('expiring', { data: 'will expire' })

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 100))

      const result = await cache.get('expiring')
      expect(result).toBeNull()
    })

    it('should delete entries', async () => {
      await cache.set('to-delete', { data: 'delete me' })
      await cache.delete('to-delete')

      const result = await cache.get('to-delete')
      expect(result).toBeNull()
    })

    it('should clear all entries', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.clear()

      expect(await cache.get('key1')).toBeNull()
      expect(await cache.get('key2')).toBeNull()
    })
  })
})
