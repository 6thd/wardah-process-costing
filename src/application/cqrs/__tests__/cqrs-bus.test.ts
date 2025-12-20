/**
 * @fileoverview Tests for CommandBus and QueryBus CQRS Implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandBus, CommandMiddleware } from '../CommandBus';
import { QueryBus, QueryMiddleware } from '../QueryBus';
import type { ICommand, IQuery, CommandResult, QueryResult } from '../types';

// Helper to create a command
function createCommand<T>(commandType: string, payload: Record<string, unknown> = {}): ICommand<T> {
  return {
    commandType,
    payload,
    timestamp: new Date(),
    correlationId: 'test-corr-id'
  } as ICommand<T>;
}

// Helper to create a query
function createQuery<T>(queryType: string, payload: Record<string, unknown> = {}): IQuery<T> {
  return {
    queryType,
    payload,
    timestamp: new Date(),
    correlationId: 'test-corr-id'
  } as IQuery<T>;
}

describe('CommandBus', () => {
  let commandBus: CommandBus;

  beforeEach(() => {
    commandBus = new CommandBus();
  });

  describe('register', () => {
    it('should register a command handler', () => {
      const handler = vi.fn();
      commandBus.register('CREATE_ORDER', () => ({ execute: handler }));
      
      expect(commandBus.hasHandler('CREATE_ORDER')).toBe(true);
    });

    it('should overwrite existing handler with warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      commandBus.register('CREATE_ORDER', () => ({ execute: vi.fn() }));
      commandBus.register('CREATE_ORDER', () => ({ execute: vi.fn() }));
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('is being overwritten')
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('hasHandler', () => {
    it('should return true for registered handler', () => {
      commandBus.register('TEST_CMD', () => ({ execute: vi.fn() }));
      expect(commandBus.hasHandler('TEST_CMD')).toBe(true);
    });

    it('should return false for unregistered handler', () => {
      expect(commandBus.hasHandler('UNKNOWN_CMD')).toBe(false);
    });
  });

  describe('dispatch', () => {
    it('should execute command and return success result', async () => {
      commandBus.register('CREATE_ITEM', () => ({
        execute: async () => ({ success: true, data: { id: 'item-1', name: 'Test Item' } })
      }));

      const command = createCommand<{ id: string; name: string }>('CREATE_ITEM', { name: 'Test Item' });
      const result = await commandBus.dispatch(command);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 'item-1', name: 'Test Item' });
    });

    it('should return error for unregistered command', async () => {
      const command = createCommand<void>('UNKNOWN_COMMAND');
      const result = await commandBus.dispatch(command);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('HANDLER_NOT_FOUND');
    });

    it('should handle handler exceptions', async () => {
      commandBus.register('FAILING_CMD', () => ({
        execute: async () => { throw new Error('Handler error'); }
      }));

      const command = createCommand<void>('FAILING_CMD');
      const result = await commandBus.dispatch(command);

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Handler error');
    });

    it('should pass command to handler', async () => {
      const executeFn = vi.fn().mockResolvedValue({ success: true });
      commandBus.register('PROCESS_DATA', () => ({
        execute: executeFn
      }));

      const command = createCommand<{ success: boolean }>('PROCESS_DATA', { value: 42, name: 'test' });
      await commandBus.dispatch(command);

      expect(executeFn).toHaveBeenCalledWith(command);
    });
  });

  describe('middleware', () => {
    it('should execute before middleware', async () => {
      const beforeFn = vi.fn().mockResolvedValue(undefined);
      
      commandBus.use({ before: beforeFn });
      commandBus.register('TEST_CMD', () => ({
        execute: async () => ({ success: true, data: 'result' })
      }));

      await commandBus.dispatch(createCommand('TEST_CMD'));

      expect(beforeFn).toHaveBeenCalled();
    });

    it('should execute after middleware', async () => {
      const afterFn = vi.fn();
      
      commandBus.use({ after: afterFn });
      commandBus.register('TEST_CMD', () => ({
        execute: async () => ({ success: true, data: 'result' })
      }));

      await commandBus.dispatch(createCommand('TEST_CMD'));

      expect(afterFn).toHaveBeenCalled();
    });

    it('should stop execution if before middleware returns error', async () => {
      const executeFn = vi.fn();
      
      const middleware: CommandMiddleware = {
        before: async () => ({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid input' }
        })
      };
      
      commandBus.use(middleware);
      commandBus.register('BLOCKED_CMD', () => ({
        execute: executeFn
      }));

      const result = await commandBus.dispatch(createCommand('BLOCKED_CMD'));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
      expect(executeFn).not.toHaveBeenCalled();
    });

    it('should call error middleware on handler failure', async () => {
      const onErrorFn = vi.fn();
      
      commandBus.use({ onError: onErrorFn });
      commandBus.register('ERROR_CMD', () => ({
        execute: async () => { throw new Error('Failed'); }
      }));

      await commandBus.dispatch(createCommand('ERROR_CMD'));

      expect(onErrorFn).toHaveBeenCalled();
    });

    it('should handle middleware errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      commandBus.use({
        onError: async () => { throw new Error('Middleware error'); }
      });
      commandBus.register('ERROR_CMD', () => ({
        execute: async () => { throw new Error('Handler error'); }
      }));

      const result = await commandBus.dispatch(createCommand('ERROR_CMD'));

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Handler error'); // Original error preserved
      
      consoleSpy.mockRestore();
    });
  });

  describe('getRegisteredCommands', () => {
    it('should return list of registered command types', () => {
      commandBus.register('CMD_1', () => ({ execute: vi.fn() }));
      commandBus.register('CMD_2', () => ({ execute: vi.fn() }));
      
      const commands = commandBus.getRegisteredCommands();
      
      expect(commands).toContain('CMD_1');
      expect(commands).toContain('CMD_2');
    });
  });

  describe('unregister', () => {
    it('should remove a registered handler', () => {
      commandBus.register('TO_REMOVE', () => ({ execute: vi.fn() }));
      expect(commandBus.hasHandler('TO_REMOVE')).toBe(true);
      
      const result = commandBus.unregister('TO_REMOVE');
      
      expect(result).toBe(true);
      expect(commandBus.hasHandler('TO_REMOVE')).toBe(false);
    });

    it('should return false for non-existent handler', () => {
      const result = commandBus.unregister('DOES_NOT_EXIST');
      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all handlers and middlewares', () => {
      commandBus.register('CMD_1', () => ({ execute: vi.fn() }));
      commandBus.use({ before: vi.fn() });
      
      commandBus.clear();
      
      expect(commandBus.hasHandler('CMD_1')).toBe(false);
      expect(commandBus.getRegisteredCommands()).toHaveLength(0);
    });
  });
});

describe('QueryBus', () => {
  let queryBus: QueryBus;

  beforeEach(() => {
    queryBus = new QueryBus();
  });

  describe('register', () => {
    it('should register a query handler', () => {
      queryBus.register('GET_ORDERS', () => ({ execute: vi.fn() }));
      expect(queryBus.hasHandler('GET_ORDERS')).toBe(true);
    });
  });

  describe('dispatch', () => {
    it('should execute query and return data', async () => {
      queryBus.register('GET_USER', () => ({
        execute: async () => ({ success: true, data: { id: 'user-1', name: 'John' } })
      }));

      const query = createQuery<{ id: string; name: string }>('GET_USER', { id: 'user-1' });
      const result = await queryBus.dispatch(query);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 'user-1', name: 'John' });
    });

    it('should return error for unregistered query', async () => {
      const query = createQuery<void>('UNKNOWN_QUERY');
      const result = await queryBus.dispatch(query);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('HANDLER_NOT_FOUND');
    });

    it('should handle query handler exceptions', async () => {
      queryBus.register('FAILING_QUERY', () => ({
        execute: async () => { throw new Error('Query failed'); }
      }));

      const result = await queryBus.dispatch(createQuery('FAILING_QUERY'));

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Query failed');
    });
  });

  describe('middleware', () => {
    it('should execute query middleware', async () => {
      const beforeFn = vi.fn().mockResolvedValue(undefined);
      
      queryBus.use({ before: beforeFn });
      queryBus.register('TEST_QUERY', () => ({
        execute: async () => ({ success: true, data: 'result' })
      }));

      await queryBus.dispatch(createQuery('TEST_QUERY'));

      expect(beforeFn).toHaveBeenCalled();
    });
  });
});

describe('CQRS Integration', () => {
  it('should separate command and query responsibilities', async () => {
    const commandBus = new CommandBus();
    const queryBus = new QueryBus();

    // Commands modify state
    const items: { id: string; name: string }[] = [];
    
    commandBus.register('CREATE_ITEM', () => ({
      execute: async (cmd: ICommand<{ id: string }>) => {
        const newItem = { id: cmd.payload.id || 'new-1', name: cmd.payload.name };
        items.push(newItem);
        return { success: true, data: newItem };
      }
    }));

    // Queries read state
    queryBus.register('GET_ITEMS', () => ({
      execute: async () => ({ success: true, data: items })
    }));

    // Execute command
    await commandBus.dispatch(createCommand('CREATE_ITEM', { id: 'item-1', name: 'Test Item' }));

    // Execute query
    const result = await queryBus.dispatch(createQuery<{ id: string; name: string }[]>('GET_ITEMS'));

    expect(result.data).toHaveLength(1);
    expect(result.data![0].name).toBe('Test Item');
  });
});
