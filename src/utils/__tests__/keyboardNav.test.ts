/**
 * Keyboard Navigation Tests
 * Tests for Excel-like table navigation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useKeyboardNav } from '../keyboardNav';

describe('useKeyboardNav', () => {
  let table: HTMLTableElement;
  let container: HTMLDivElement;

  beforeEach(() => {
    // Create a mock table
    container = document.createElement('div');
    table = document.createElement('table');
    const tbody = document.createElement('tbody');
    
    // Create 3 rows with 3 cells each
    for (let i = 0; i < 3; i++) {
      const tr = document.createElement('tr');
      for (let j = 0; j < 3; j++) {
        const td = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'text';
        input.value = `cell-${i}-${j}`;
        td.appendChild(input);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    
    table.appendChild(tbody);
    container.appendChild(table);
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('should attach event listener when table exists', () => {
    const addEventListenerSpy = vi.spyOn(table, 'addEventListener');
    
    const { result } = renderHook(() => {
      const ref = useRef<HTMLTableElement>(table);
      useKeyboardNav(ref);
      return ref;
    });

    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('should remove event listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(table, 'removeEventListener');
    
    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLTableElement>(table);
      useKeyboardNav(ref);
      return ref;
    });

    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('should handle ArrowRight key', () => {
    renderHook(() => {
      const ref = useRef<HTMLTableElement>(table);
      useKeyboardNav(ref);
      return ref;
    });

    const firstInput = table.querySelector('input') as HTMLInputElement;
    firstInput.focus();

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
    firstInput.dispatchEvent(event);

    // Second cell input should be focused
    const secondInput = table.querySelectorAll('input')[1];
    expect(document.activeElement).toBe(secondInput);
  });

  it('should handle ArrowLeft key', () => {
    renderHook(() => {
      const ref = useRef<HTMLTableElement>(table);
      useKeyboardNav(ref);
      return ref;
    });

    const secondInput = table.querySelectorAll('input')[1] as HTMLInputElement;
    secondInput.focus();

    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
    secondInput.dispatchEvent(event);

    // First cell input should be focused
    const firstInput = table.querySelector('input');
    expect(document.activeElement).toBe(firstInput);
  });

  it('should handle ArrowDown key', () => {
    renderHook(() => {
      const ref = useRef<HTMLTableElement>(table);
      useKeyboardNav(ref);
      return ref;
    });

    const firstInput = table.querySelector('input') as HTMLInputElement;
    firstInput.focus();

    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
    firstInput.dispatchEvent(event);

    // Second row first cell should be focused
    const secondRowInput = table.querySelectorAll('tr')[1].querySelector('input');
    expect(document.activeElement).toBe(secondRowInput);
  });

  it('should handle ArrowUp key', () => {
    renderHook(() => {
      const ref = useRef<HTMLTableElement>(table);
      useKeyboardNav(ref);
      return ref;
    });

    const secondRowInput = table.querySelectorAll('tr')[1].querySelector('input') as HTMLInputElement;
    secondRowInput.focus();

    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
    secondRowInput.dispatchEvent(event);

    // First row first cell should be focused
    const firstRowInput = table.querySelector('input');
    expect(document.activeElement).toBe(firstRowInput);
  });

  it('should handle Delete key to clear input', () => {
    renderHook(() => {
      const ref = useRef<HTMLTableElement>(table);
      useKeyboardNav(ref);
      return ref;
    });

    const firstInput = table.querySelector('input') as HTMLInputElement;
    firstInput.value = 'test value';
    firstInput.focus();

    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true });
    firstInput.dispatchEvent(event);

    expect(firstInput.value).toBe('');
  });

  it('should not clear already empty input on Delete', () => {
    renderHook(() => {
      const ref = useRef<HTMLTableElement>(table);
      useKeyboardNav(ref);
      return ref;
    });

    const firstInput = table.querySelector('input') as HTMLInputElement;
    firstInput.value = '';
    firstInput.focus();

    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    firstInput.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('should respect data-disable-nav attribute', () => {
    renderHook(() => {
      const ref = useRef<HTMLTableElement>(table);
      useKeyboardNav(ref);
      return ref;
    });

    const firstInput = table.querySelector('input') as HTMLInputElement;
    firstInput.dataset.disableNav = 'true';
    firstInput.focus();

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
    firstInput.dispatchEvent(event);

    // Should not move - first input should still be focused
    expect(document.activeElement).toBe(firstInput);
  });

  it('should do nothing when table ref is null', () => {
    const { result } = renderHook(() => {
      const ref = useRef<HTMLTableElement>(null);
      useKeyboardNav(ref);
      return ref;
    });

    // Should not throw
    expect(result.current.current).toBeNull();
  });

  it('should handle edge case - last cell ArrowRight', () => {
    renderHook(() => {
      const ref = useRef<HTMLTableElement>(table);
      useKeyboardNav(ref);
      return ref;
    });

    // Focus last cell in first row
    const lastCellFirstRow = table.querySelectorAll('tr')[0].querySelectorAll('input')[2] as HTMLInputElement;
    lastCellFirstRow.focus();

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
    lastCellFirstRow.dispatchEvent(event);

    // Should stay at last cell since there's no more cells
    // (depends on implementation - might stay or wrap)
    expect(document.activeElement).toBe(lastCellFirstRow);
  });

  it('should handle edge case - first cell ArrowLeft', () => {
    renderHook(() => {
      const ref = useRef<HTMLTableElement>(table);
      useKeyboardNav(ref);
      return ref;
    });

    const firstInput = table.querySelector('input') as HTMLInputElement;
    firstInput.focus();

    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
    firstInput.dispatchEvent(event);

    // Should stay at first cell
    expect(document.activeElement).toBe(firstInput);
  });

  it('should handle edge case - first row ArrowUp', () => {
    renderHook(() => {
      const ref = useRef<HTMLTableElement>(table);
      useKeyboardNav(ref);
      return ref;
    });

    const firstInput = table.querySelector('input') as HTMLInputElement;
    firstInput.focus();

    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
    firstInput.dispatchEvent(event);

    // Should stay at first row
    expect(document.activeElement).toBe(firstInput);
  });

  it('should select text in input when focusing via arrow keys', () => {
    renderHook(() => {
      const ref = useRef<HTMLTableElement>(table);
      useKeyboardNav(ref);
      return ref;
    });

    const firstInput = table.querySelector('input') as HTMLInputElement;
    const secondInput = table.querySelectorAll('input')[1] as HTMLInputElement;
    secondInput.value = 'test value';
    
    const selectSpy = vi.spyOn(secondInput, 'select');
    firstInput.focus();

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
    firstInput.dispatchEvent(event);

    expect(selectSpy).toHaveBeenCalled();
  });
});
