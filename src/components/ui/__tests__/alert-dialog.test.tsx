import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

describe('AlertDialog accessibility contract', () => {
  it('exposes open destructive confirmations as a modal alertdialog', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Delete role</AlertDialogTitle>
          <AlertDialogDescription>Owned fixture role</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
    );

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('Delete role');
    expect(dialog).toHaveTextContent('Owned fixture role');
  });
});
