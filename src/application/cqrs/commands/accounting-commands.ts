/**
 * @fileoverview Accounting Commands
 * @description أوامر المحاسبة (CQRS Commands)
 */

import type { ICommand } from '../types'

// ===== Command Types =====

export const AccountingCommandTypes = {
  CREATE_JOURNAL_ENTRY: 'accounting.createJournalEntry',
  POST_JOURNAL_ENTRY: 'accounting.postJournalEntry',
  REVERSE_JOURNAL_ENTRY: 'accounting.reverseJournalEntry',
  CREATE_ACCOUNT: 'accounting.createAccount',
  UPDATE_ACCOUNT: 'accounting.updateAccount',
  CLOSE_PERIOD: 'accounting.closePeriod',
  REOPEN_PERIOD: 'accounting.reopenPeriod'
} as const

// ===== Create Journal Entry Command =====

export interface CreateJournalEntryCommand extends ICommand<CreateJournalEntryResult> {
  commandType: typeof AccountingCommandTypes.CREATE_JOURNAL_ENTRY
  date: Date
  reference?: string
  description: string
  lines: JournalEntryLineInput[]
  attachments?: string[]
  tags?: string[]
}

export interface JournalEntryLineInput {
  accountId: string
  debit: number
  credit: number
  description?: string
  costCenterId?: string
}

export interface CreateJournalEntryResult {
  entryId: string
  entryNumber: string
  createdAt: Date
}

export function createCreateJournalEntryCommand(
  params: Omit<CreateJournalEntryCommand, 'commandType' | 'timestamp'>
): CreateJournalEntryCommand {
  return {
    commandType: AccountingCommandTypes.CREATE_JOURNAL_ENTRY,
    timestamp: new Date(),
    ...params
  }
}

// ===== Post Journal Entry Command =====

export interface PostJournalEntryCommand extends ICommand<PostJournalEntryResult> {
  commandType: typeof AccountingCommandTypes.POST_JOURNAL_ENTRY
  entryId: string
}

export interface PostJournalEntryResult {
  entryId: string
  postedAt: Date
}

export function createPostJournalEntryCommand(
  params: Omit<PostJournalEntryCommand, 'commandType' | 'timestamp'>
): PostJournalEntryCommand {
  return {
    commandType: AccountingCommandTypes.POST_JOURNAL_ENTRY,
    timestamp: new Date(),
    ...params
  }
}

// ===== Reverse Journal Entry Command =====

export interface ReverseJournalEntryCommand extends ICommand<ReverseJournalEntryResult> {
  commandType: typeof AccountingCommandTypes.REVERSE_JOURNAL_ENTRY
  entryId: string
  reversalDate: Date
  reason: string
}

export interface ReverseJournalEntryResult {
  originalEntryId: string
  reversalEntryId: string
  reversedAt: Date
}

export function createReverseJournalEntryCommand(
  params: Omit<ReverseJournalEntryCommand, 'commandType' | 'timestamp'>
): ReverseJournalEntryCommand {
  return {
    commandType: AccountingCommandTypes.REVERSE_JOURNAL_ENTRY,
    timestamp: new Date(),
    ...params
  }
}

// ===== Create Account Command =====

export interface CreateAccountCommand extends ICommand<CreateAccountResult> {
  commandType: typeof AccountingCommandTypes.CREATE_ACCOUNT
  code: string
  name: string
  nameEn?: string
  accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  parentId?: string
  description?: string
  isActive?: boolean
}

export interface CreateAccountResult {
  accountId: string
  createdAt: Date
}

export function createCreateAccountCommand(
  params: Omit<CreateAccountCommand, 'commandType' | 'timestamp'>
): CreateAccountCommand {
  return {
    commandType: AccountingCommandTypes.CREATE_ACCOUNT,
    timestamp: new Date(),
    ...params
  }
}

// ===== Update Account Command =====

export interface UpdateAccountCommand extends ICommand<UpdateAccountResult> {
  commandType: typeof AccountingCommandTypes.UPDATE_ACCOUNT
  accountId: string
  name?: string
  nameEn?: string
  description?: string
  isActive?: boolean
}

export interface UpdateAccountResult {
  accountId: string
  updatedAt: Date
}

export function createUpdateAccountCommand(
  params: Omit<UpdateAccountCommand, 'commandType' | 'timestamp'>
): UpdateAccountCommand {
  return {
    commandType: AccountingCommandTypes.UPDATE_ACCOUNT,
    timestamp: new Date(),
    ...params
  }
}

// ===== Close Period Command =====

export interface ClosePeriodCommand extends ICommand<ClosePeriodResult> {
  commandType: typeof AccountingCommandTypes.CLOSE_PERIOD
  year: number
  month: number
}

export interface ClosePeriodResult {
  periodId: string
  closedAt: Date
}

export function createClosePeriodCommand(
  params: Omit<ClosePeriodCommand, 'commandType' | 'timestamp'>
): ClosePeriodCommand {
  return {
    commandType: AccountingCommandTypes.CLOSE_PERIOD,
    timestamp: new Date(),
    ...params
  }
}

// ===== Reopen Period Command =====

export interface ReopenPeriodCommand extends ICommand<ReopenPeriodResult> {
  commandType: typeof AccountingCommandTypes.REOPEN_PERIOD
  periodId: string
  reason: string
}

export interface ReopenPeriodResult {
  periodId: string
  reopenedAt: Date
}

export function createReopenPeriodCommand(
  params: Omit<ReopenPeriodCommand, 'commandType' | 'timestamp'>
): ReopenPeriodCommand {
  return {
    commandType: AccountingCommandTypes.REOPEN_PERIOD,
    timestamp: new Date(),
    ...params
  }
}

// ===== Union Type =====

export type AccountingCommand =
  | CreateJournalEntryCommand
  | PostJournalEntryCommand
  | ReverseJournalEntryCommand
  | CreateAccountCommand
  | UpdateAccountCommand
  | ClosePeriodCommand
  | ReopenPeriodCommand
