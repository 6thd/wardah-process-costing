/**
 * Dependency Injection Container
 * 
 * حاوية حقن التبعيات لربط الـ Interfaces بالتنفيذات
 * يسهل الاختبار والتبديل بين التنفيذات المختلفة
 */

import type { IProcessCostingRepository } from '@/domain/interfaces/IProcessCostingRepository'
import { SupabaseProcessCostingRepository } from '@/infrastructure/repositories/SupabaseProcessCostingRepository'
import { CalculateProcessCostUseCase } from '@/domain/use-cases/CalculateProcessCost'

/**
 * Container بسيط للـ Dependency Injection
 */
class Container {
  private instances: Map<string, any> = new Map()
  private factories: Map<string, () => any> = new Map()

  /**
   * تسجيل singleton
   */
  registerSingleton<T>(key: string, instance: T): void {
    this.instances.set(key, instance)
  }

  /**
   * تسجيل factory
   */
  registerFactory<T>(key: string, factory: () => T): void {
    this.factories.set(key, factory)
  }

  /**
   * الحصول على instance
   */
  resolve<T>(key: string): T {
    // أولاً نبحث في الـ singletons
    if (this.instances.has(key)) {
      return this.instances.get(key)
    }

    // ثم في الـ factories
    if (this.factories.has(key)) {
      const instance = this.factories.get(key)!()
      this.instances.set(key, instance) // cache للاستخدام المستقبلي
      return instance
    }

    throw new Error(`الخدمة غير مسجلة: ${key}`)
  }

  /**
   * إعادة تعيين الحاوية (مفيد للاختبارات)
   */
  reset(): void {
    this.instances.clear()
    this.factories.clear()
  }
}

// إنشاء الحاوية الرئيسية
export const container = new Container()

// ===== تسجيل التبعيات =====

// Repositories
container.registerFactory<IProcessCostingRepository>(
  'IProcessCostingRepository',
  () => new SupabaseProcessCostingRepository()
)

// Use Cases
container.registerFactory<CalculateProcessCostUseCase>(
  'CalculateProcessCostUseCase',
  () => new CalculateProcessCostUseCase(
    container.resolve<IProcessCostingRepository>('IProcessCostingRepository')
  )
)

// ===== Helper Functions =====

/**
 * الحصول على Use Case لحساب تكاليف العمليات
 */
export function getCalculateProcessCostUseCase(): CalculateProcessCostUseCase {
  return container.resolve<CalculateProcessCostUseCase>('CalculateProcessCostUseCase')
}

/**
 * الحصول على Repository
 */
export function getProcessCostingRepository(): IProcessCostingRepository {
  return container.resolve<IProcessCostingRepository>('IProcessCostingRepository')
}
