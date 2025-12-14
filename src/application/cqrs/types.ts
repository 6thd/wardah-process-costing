/**
 * @fileoverview CQRS Types and Interfaces
 * @description أنواع وواجهات نمط CQRS (Command Query Responsibility Segregation)
 */

// ===== Base Types =====

/**
 * نتيجة تنفيذ الأمر
 */
export interface CommandResult<T = void> {
  success: boolean
  data?: T
  error?: CommandError
}

export interface CommandError {
  code: string
  message: string
  details?: Record<string, unknown>
}

/**
 * نتيجة الاستعلام
 */
export interface QueryResult<T> {
  success: boolean
  data?: T
  error?: QueryError
  metadata?: QueryMetadata
}

export interface QueryError {
  code: string
  message: string
}

export interface QueryMetadata {
  totalCount?: number
  pageSize?: number
  currentPage?: number
  hasMore?: boolean
  executionTime?: number
  cached?: boolean
}

// ===== Command Interface =====

/**
 * واجهة الأمر الأساسية
 */
export interface ICommand<TResult = void> {
  readonly commandType: string
  readonly timestamp: Date
  readonly userId?: string
  readonly organizationId?: string
  readonly correlationId?: string
}

/**
 * معالج الأوامر
 */
export interface ICommandHandler<TCommand extends ICommand<TResult>, TResult = void> {
  execute(command: TCommand): Promise<CommandResult<TResult>>
}

// ===== Query Interface =====

/**
 * واجهة الاستعلام الأساسية
 */
export interface IQuery<TResult> {
  readonly queryType: string
  readonly timestamp: Date
  readonly organizationId?: string
}

/**
 * معالج الاستعلامات
 */
export interface IQueryHandler<TQuery extends IQuery<TResult>, TResult> {
  execute(query: TQuery): Promise<QueryResult<TResult>>
}

// ===== Command Bus =====

export type CommandHandlerFactory<TCommand extends ICommand<TResult>, TResult = void> = 
  () => ICommandHandler<TCommand, TResult>

export interface ICommandBus {
  register<TCommand extends ICommand<TResult>, TResult>(
    commandType: string,
    handlerFactory: CommandHandlerFactory<TCommand, TResult>
  ): void
  
  dispatch<TResult>(command: ICommand<TResult>): Promise<CommandResult<TResult>>
  
  hasHandler(commandType: string): boolean
}

// ===== Query Bus =====

export type QueryHandlerFactory<TQuery extends IQuery<TResult>, TResult> = 
  () => IQueryHandler<TQuery, TResult>

export interface IQueryBus {
  register<TQuery extends IQuery<TResult>, TResult>(
    queryType: string,
    handlerFactory: QueryHandlerFactory<TQuery, TResult>
  ): void
  
  dispatch<TResult>(query: IQuery<TResult>): Promise<QueryResult<TResult>>
  
  hasHandler(queryType: string): boolean
}

// ===== Pagination =====

export interface PaginationParams {
  page: number
  pageSize: number
}

export interface SortParams {
  field: string
  direction: 'asc' | 'desc'
}

export interface FilterParams {
  field: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in' | 'between'
  value: unknown
}
