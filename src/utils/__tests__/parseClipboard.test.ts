/**
 * Parse Clipboard Tests
 * Tests for clipboard parsing utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseClipboardTable } from '../parseClipboard';

describe('parseClipboardTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse tab-separated values', async () => {
    const mockReadText = vi.fn().mockResolvedValue('A\tB\tC\n1\t2\t3');
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: mockReadText },
      writable: true,
      configurable: true,
    });

    const result = await parseClipboardTable();
    
    expect(result).toEqual([
      ['A', 'B', 'C'],
      ['1', '2', '3'],
    ]);
  });

  it('should handle Windows line endings (CRLF)', async () => {
    const mockReadText = vi.fn().mockResolvedValue('A\tB\r\n1\t2');
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: mockReadText },
      writable: true,
      configurable: true,
    });

    const result = await parseClipboardTable();
    
    expect(result).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
  });

  it('should handle Unix line endings (LF)', async () => {
    const mockReadText = vi.fn().mockResolvedValue('A\tB\n1\t2');
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: mockReadText },
      writable: true,
      configurable: true,
    });

    const result = await parseClipboardTable();
    
    expect(result).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
  });

  it('should filter out empty rows', async () => {
    const mockReadText = vi.fn().mockResolvedValue('A\tB\n\n1\t2\n\n');
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: mockReadText },
      writable: true,
      configurable: true,
    });

    const result = await parseClipboardTable();
    
    expect(result).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
  });

  it('should filter out rows with only whitespace', async () => {
    const mockReadText = vi.fn().mockResolvedValue('A\tB\n  \t  \n1\t2');
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: mockReadText },
      writable: true,
      configurable: true,
    });

    const result = await parseClipboardTable();
    
    expect(result).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
  });

  it('should handle single cell', async () => {
    const mockReadText = vi.fn().mockResolvedValue('Single Value');
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: mockReadText },
      writable: true,
      configurable: true,
    });

    const result = await parseClipboardTable();
    
    expect(result).toEqual([['Single Value']]);
  });

  it('should handle empty clipboard', async () => {
    const mockReadText = vi.fn().mockResolvedValue('');
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: mockReadText },
      writable: true,
      configurable: true,
    });

    const result = await parseClipboardTable();
    
    expect(result).toEqual([]);
  });

  it('should preserve cell values with spaces', async () => {
    const mockReadText = vi.fn().mockResolvedValue('Hello World\tFoo Bar\nTest 123\tValue');
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: mockReadText },
      writable: true,
      configurable: true,
    });

    const result = await parseClipboardTable();
    
    expect(result).toEqual([
      ['Hello World', 'Foo Bar'],
      ['Test 123', 'Value'],
    ]);
  });

  it('should handle many columns', async () => {
    const mockReadText = vi.fn().mockResolvedValue('A\tB\tC\tD\tE\tF\tG');
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: mockReadText },
      writable: true,
      configurable: true,
    });

    const result = await parseClipboardTable();
    
    expect(result).toEqual([['A', 'B', 'C', 'D', 'E', 'F', 'G']]);
  });

  it('should handle numeric values', async () => {
    const mockReadText = vi.fn().mockResolvedValue('100\t200.50\t-50');
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: mockReadText },
      writable: true,
      configurable: true,
    });

    const result = await parseClipboardTable();
    
    expect(result).toEqual([['100', '200.50', '-50']]);
  });

  it('should handle special characters', async () => {
    const mockReadText = vi.fn().mockResolvedValue('مرحبا\tHello\n日本語\t한국어');
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: mockReadText },
      writable: true,
      configurable: true,
    });

    const result = await parseClipboardTable();
    
    expect(result).toEqual([
      ['مرحبا', 'Hello'],
      ['日本語', '한국어'],
    ]);
  });
});
