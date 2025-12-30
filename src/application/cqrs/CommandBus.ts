/**
 * @fileoverview Command Bus Implementation
 * @description تنفيذ ناقل الأوامر
 */

import type { 
  ICommand, 
  ICommandBus, 
  ICommandHandler, 
  CommandResult,
  CommandHandlerFactory,
  CommandError
} from './types'

/**
 * ناقل الأوامر - In-Memory Implementation
 */
export class CommandBus implements ICommandBus {
  private readonly handlers: Map<string, CommandHandlerFactory<ICommand<unknown>, unknown>> = new Map()
  private middlewares: CommandMiddleware[] = []

  /**
   * تسجيل معالج أمر
   */
  register<TCommand extends ICommand<TResult>, TResult>(
    commandType: string,
    handlerFactory: CommandHandlerFactory<TCommand, TResult>
  ): void {
    if (this.handlers.has(commandType)) {
      console.warn(`Handler for command type "${commandType}" is being overwritten`)
    }
    this.handlers.set(
      commandType, 
      handlerFactory as CommandHandlerFactory<ICommand<unknown>, unknown>
    )
  }

  /**
   * التحقق من وجود معالج
   */
  hasHandler(commandType: string): boolean {
    return this.handlers.has(commandType)
  }

  /**
   * إضافة middleware
   */
  use(middleware: CommandMiddleware): void {
    this.middlewares.push(middleware)
  }

  /**
   * تنفيذ middlewares قبل الأمر
   */
  private async executeBeforeMiddlewares<TResult>(
    command: ICommand<TResult>
  ): Promise<CommandResult<TResult> | null> {
    for (const middleware of this.middlewares) {
      if (middleware.before) {
        const result = await middleware.before(command)
        if (result && !result.success) {
          return result as CommandResult<TResult>
        }
      }
    }
    return null
  }

  /**
   * تنفيذ middlewares بعد الأمر
   */
  private async executeAfterMiddlewares<TResult>(
    command: ICommand<TResult>,
    result: CommandResult<TResult>
  ): Promise<void> {
    for (const middleware of this.middlewares) {
      if (middleware.after) {
        await middleware.after(command, result)
      }
    }
  }

  /**
   * تنفيذ middlewares عند الخطأ
   * Note: Middleware errors are caught to prevent masking the original command error
   */
  private async executeErrorMiddlewares<TResult>(
    command: ICommand<TResult>,
    error: CommandError
  ): Promise<void> {
    for (const middleware of this.middlewares) {
      if (middleware.onError) {
        try {
          await middleware.onError(command, error)
        } catch (middlewareError) {
          // Log middleware error but don't mask the original command error
          console.error('Error middleware failed:', middlewareError)
        }
      }
    }
  }

  /**
   * إرسال الأمر للتنفيذ
   */
  async dispatch<TResult>(command: ICommand<TResult>): Promise<CommandResult<TResult>> {
    const handlerFactory = this.handlers.get(command.commandType)
    
    if (!handlerFactory) {
      return {
        success: false,
        error: {
          code: 'HANDLER_NOT_FOUND',
          message: `No handler registered for command type: ${command.commandType}`
        }
      }
    }

    try {
      // تنفيذ middlewares قبل الأمر
      const beforeResult = await this.executeBeforeMiddlewares(command)
      if (beforeResult) {
        return beforeResult
      }

      // إنشاء المعالج وتنفيذ الأمر
      const handler = handlerFactory() as ICommandHandler<ICommand<TResult>, TResult>
      const result = await handler.execute(command)

      // تنفيذ middlewares بعد الأمر - wrapped in try-catch to not mask successful results
      // Commands may have side effects (DB writes), so we return the result even if after-middleware fails
      try {
        await this.executeAfterMiddlewares(command, result)
      } catch (afterMiddlewareError) {
        console.error('After-middleware error (command succeeded):', afterMiddlewareError)
        // Still return the successful result - don't mask it with middleware error
      }

      return result
    } catch (error) {
      const commandError: CommandError = {
        code: 'EXECUTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        details: error instanceof Error ? { stack: error.stack } : undefined
      }

      // تنفيذ middlewares عند الخطأ
      await this.executeErrorMiddlewares(command, commandError)

      return {
        success: false,
        error: commandError
      }
    }
  }

  /**
   * إلغاء تسجيل معالج
   */
  unregister(commandType: string): boolean {
    return this.handlers.delete(commandType)
  }

  /**
   * الحصول على أنواع الأوامر المسجلة
   */
  getRegisteredCommands(): string[] {
    return Array.from(this.handlers.keys())
  }

  /**
   * مسح جميع المعالجات
   */
  clear(): void {
    this.handlers.clear()
    this.middlewares = []
  }
}

/**
 * واجهة Middleware للأوامر
 */
export interface CommandMiddleware {
  before?(command: ICommand<unknown>): Promise<CommandResult<unknown> | void>
  after?(command: ICommand<unknown>, result: CommandResult<unknown>): Promise<void>
  onError?(command: ICommand<unknown>, error: CommandError): Promise<void>
}

/**
 * Middleware للتسجيل (Logging)
 */
export class LoggingMiddleware implements CommandMiddleware {
  async before(command: ICommand<unknown>): Promise<void> {
    // Logging removed to comply with ESLint no-console rule
    // Consider using a proper logging service in production
  }

  async after(command: ICommand<unknown>, result: CommandResult<unknown>): Promise<void> {
    // Logging removed to comply with ESLint no-console rule
    // Consider using a proper logging service in production
  }

  async onError(command: ICommand<unknown>, error: CommandError): Promise<void> {
    console.error(`[Command] Error: ${command.commandType}`, error)
  }
}

/**
 * Middleware للتحقق من الصلاحيات
 */
export class AuthorizationMiddleware implements CommandMiddleware {
  constructor(private readonly checkPermission: (userId: string, commandType: string) => Promise<boolean>) {}

  async before(command: ICommand<unknown>): Promise<CommandResult<unknown> | void> {
    if (!command.userId) {
      return {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User ID is required'
        }
      }
    }

    const hasPermission = await this.checkPermission(command.userId, command.commandType)
    if (!hasPermission) {
      return {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'User does not have permission to execute this command'
        }
      }
    }
  }
}

/**
 * Middleware للتحقق من صحة البيانات
 */
export class ValidationMiddleware implements CommandMiddleware {
  private readonly validators: Map<string, (command: ICommand<unknown>) => ValidationResult> = new Map()

  registerValidator(
    commandType: string, 
    validator: (command: ICommand<unknown>) => ValidationResult
  ): void {
    this.validators.set(commandType, validator)
  }

  async before(command: ICommand<unknown>): Promise<CommandResult<unknown> | void> {
    const validator = this.validators.get(command.commandType)
    if (validator) {
      const result = validator(command)
      if (!result.isValid) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Command validation failed',
            details: { errors: result.errors }
          }
        }
      }
    }
  }
}

export interface ValidationResult {
  isValid: boolean
  errors?: string[]
}

// ===== Singleton =====

let commandBusInstance: CommandBus | null = null

export function getCommandBus(): CommandBus {
  if (!commandBusInstance) {
    commandBusInstance = new CommandBus()
  }
  return commandBusInstance
}

export function resetCommandBus(): void {
  if (commandBusInstance) {
    commandBusInstance.clear()
  }
  commandBusInstance = null
}
