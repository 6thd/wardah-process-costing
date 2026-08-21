import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CompanyLogoPanel,
  CompanySettingsHeader,
  CompanySettingsLoading,
} from '../CompanySettingsSections';

const tr = (_arabic: string, english: string) => english;

describe('CompanySettingsSections', () => {
  it('keeps the save action permission-gated and shows the unsaved state', () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <CompanySettingsHeader
        isRTL={false}
        canUpdate={false}
        hasChanges
        isSaving={false}
        onSave={onSave}
        tr={tr}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();

    rerender(
      <CompanySettingsHeader
        isRTL={false}
        canUpdate
        hasChanges={false}
        isSaving={false}
        onSave={onSave}
        tr={tr}
      />,
    );
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();

    rerender(
      <CompanySettingsHeader
        isRTL={false}
        canUpdate
        hasChanges
        isSaving={false}
        onSave={onSave}
        tr={tr}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(onSave).toHaveBeenCalledOnce();

    rerender(
      <CompanySettingsHeader
        isRTL
        canUpdate
        hasChanges
        isSaving
        onSave={onSave}
        tr={tr}
      />,
    );
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  });

  it('keeps logo upload inaccessible to read-only users', () => {
    const fileInputRef = createRef<HTMLInputElement>();
    const onLogoUpload = vi.fn();
    const { container } = render(
      <CompanyLogoPanel
        logoUrl=""
        organizationCode="ORG1"
        canUpdate={false}
        isUploadingLogo={false}
        fileInputRef={fileInputRef}
        onLogoUpload={onLogoUpload}
        onDeleteLogo={vi.fn()}
        tr={tr}
      />,
    );
    const fileInput = fileInputRef.current;
    if (!fileInput) throw new Error('Expected the logo file input to be mounted');
    const clickSpy = vi.spyOn(fileInput, 'click');

    fireEvent.click(screen.getByRole('button', { name: 'Click to upload logo' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Click to upload logo' }), {
      key: 'Enter',
    });
    expect(clickSpy).not.toHaveBeenCalled();
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(screen.getByText('ORG1')).toBeInTheDocument();
  });

  it('forwards file changes and exposes logo actions only with update permission', () => {
    const fileInputRef = createRef<HTMLInputElement>();
    const onLogoUpload = vi.fn();
    const onDeleteLogo = vi.fn();
    const { container, rerender } = render(
      <CompanyLogoPanel
        logoUrl=""
        canUpdate
        isUploadingLogo={false}
        fileInputRef={fileInputRef}
        onLogoUpload={onLogoUpload}
        onDeleteLogo={onDeleteLogo}
        tr={tr}
      />,
    );
    const file = new File(['logo'], 'logo.png', { type: 'image/png' });
    const filePicker = screen.getByRole('button', { name: 'Click to upload logo' });
    const fileInput = fileInputRef.current;
    if (!fileInput) throw new Error('Expected the logo file input to be mounted');
    const clickSpy = vi.spyOn(fileInput, 'click');
    fireEvent.click(filePicker);
    fireEvent.keyDown(filePicker, { key: 'Enter' });
    fireEvent.keyDown(filePicker, { key: ' ' });
    fireEvent.keyDown(filePicker, { key: 'Escape' });
    expect(clickSpy).toHaveBeenCalledTimes(3);
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(onLogoUpload).toHaveBeenCalledOnce();

    rerender(
      <CompanyLogoPanel
        logoUrl="https://example.com/logo.png"
        canUpdate
        isUploadingLogo={false}
        fileInputRef={fileInputRef}
        onLogoUpload={onLogoUpload}
        onDeleteLogo={onDeleteLogo}
        tr={tr}
      />,
    );
    expect(screen.getByRole('img', { name: 'Company logo' })).toBeInTheDocument();
    const actionButtons = container.querySelectorAll('button');
    expect(actionButtons).toHaveLength(2);
    fireEvent.click(actionButtons[0]);
    expect(clickSpy).toHaveBeenCalledTimes(4);
    fireEvent.click(actionButtons[1]);
    expect(onDeleteLogo).toHaveBeenCalledOnce();

    rerender(
      <CompanyLogoPanel
        logoUrl="https://example.com/logo.png"
        canUpdate={false}
        isUploadingLogo={false}
        fileInputRef={fileInputRef}
        onLogoUpload={onLogoUpload}
        onDeleteLogo={onDeleteLogo}
        tr={tr}
      />,
    );
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('shows logo upload progress', () => {
    const fileInputRef = createRef<HTMLInputElement>();
    const { container } = render(
      <CompanyLogoPanel
        logoUrl=""
        canUpdate
        isUploadingLogo
        fileInputRef={fileInputRef}
        onLogoUpload={vi.fn()}
        onDeleteLogo={vi.fn()}
        tr={tr}
      />,
    );
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders the loading contract', () => {
    render(<CompanySettingsLoading tr={tr} />);
    expect(screen.getByText('Loading company data...')).toBeInTheDocument();
  });
});
