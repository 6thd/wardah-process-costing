import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

describe('DialogContent viewport reachability', () => {
  it('keeps oversized dialog content scrollable within the viewport', () => {
    render(
      <Dialog open>
        <DialogContent data-testid="dialog-content">
          <DialogTitle>Test dialog</DialogTitle>
          <DialogDescription>Viewport overflow regression guard</DialogDescription>
          <div>Long content</div>
        </DialogContent>
      </Dialog>
    );

    const dialog = screen.getByTestId('dialog-content');

    expect(dialog.className).toContain('max-h-[calc(100vh-2rem)]');
    expect(dialog.className).toContain('overflow-y-auto');
  });
});
