/**
 * @fileoverview Tests for Accounting Components (ModuleCard, QuickStats)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ModuleCard } from '../ModuleCard';
import { QuickStats } from '../QuickStats';
import { FileText } from 'lucide-react';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('ModuleCard', () => {
  const defaultProps = {
    title: 'Journal Entries',
    description: 'Manage journal entries',
    icon: FileText,
    href: '/accounting/journal',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    features: ['Create entries', 'View entries', 'Post entries'],
    isRTL: false,
  };

  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('should render module card with title', () => {
    render(
      <BrowserRouter>
        <ModuleCard {...defaultProps} />
      </BrowserRouter>
    );

    expect(screen.getByText('Journal Entries')).toBeInTheDocument();
  });

  it('should render description', () => {
    render(
      <BrowserRouter>
        <ModuleCard {...defaultProps} />
      </BrowserRouter>
    );

    expect(screen.getByText('Manage journal entries')).toBeInTheDocument();
  });

  it('should render all features', () => {
    render(
      <BrowserRouter>
        <ModuleCard {...defaultProps} />
      </BrowserRouter>
    );

    expect(screen.getByText('Create entries')).toBeInTheDocument();
    expect(screen.getByText('View entries')).toBeInTheDocument();
    expect(screen.getByText('Post entries')).toBeInTheDocument();
  });

  it('should show Open button in English', () => {
    render(
      <BrowserRouter>
        <ModuleCard {...defaultProps} isRTL={false} />
      </BrowserRouter>
    );

    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('should show فتح button in Arabic', () => {
    render(
      <BrowserRouter>
        <ModuleCard {...defaultProps} isRTL={true} />
      </BrowserRouter>
    );

    expect(screen.getByRole('button', { name: 'فتح' })).toBeInTheDocument();
  });

  it('should navigate on card click', () => {
    render(
      <BrowserRouter>
        <ModuleCard {...defaultProps} />
      </BrowserRouter>
    );

    const card = screen.getByText('Journal Entries').closest('.cursor-pointer');
    fireEvent.click(card!);

    expect(mockNavigate).toHaveBeenCalledWith('/accounting/journal');
  });

  it('should navigate on button click', () => {
    render(
      <BrowserRouter>
        <ModuleCard {...defaultProps} />
      </BrowserRouter>
    );

    const button = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(button);

    expect(mockNavigate).toHaveBeenCalledWith('/accounting/journal');
  });

  it('should render icon', () => {
    render(
      <BrowserRouter>
        <ModuleCard {...defaultProps} />
      </BrowserRouter>
    );

    // Icon should be rendered
    const iconContainer = document.querySelector('.bg-blue-100');
    expect(iconContainer).toBeInTheDocument();
  });

  it('should apply hover styles', () => {
    render(
      <BrowserRouter>
        <ModuleCard {...defaultProps} />
      </BrowserRouter>
    );

    const card = document.querySelector('.hover\\:shadow-lg');
    expect(card).toBeInTheDocument();
  });

  it('should handle empty features array', () => {
    render(
      <BrowserRouter>
        <ModuleCard {...defaultProps} features={[]} />
      </BrowserRouter>
    );

    expect(screen.getByText('Journal Entries')).toBeInTheDocument();
  });
});

describe('QuickStats', () => {
  it('should render all 4 stat cards', () => {
    render(<QuickStats isRTL={false} />);

    expect(screen.getByText('Draft Entries')).toBeInTheDocument();
    expect(screen.getByText('Posted Entries')).toBeInTheDocument();
    expect(screen.getByText('Total Accounts')).toBeInTheDocument();
    expect(screen.getByText('Last Entry')).toBeInTheDocument();
  });

  it('should show English labels when isRTL is false', () => {
    render(<QuickStats isRTL={false} />);

    expect(screen.getByText('Draft Entries')).toBeInTheDocument();
    expect(screen.getByText('Pending posting')).toBeInTheDocument();
  });

  it('should show Arabic labels when isRTL is true', () => {
    render(<QuickStats isRTL={true} />);

    expect(screen.getByText('القيود المسودة')).toBeInTheDocument();
    expect(screen.getByText('في انتظار الترحيل')).toBeInTheDocument();
  });

  it('should show Posted Entries in Arabic', () => {
    render(<QuickStats isRTL={true} />);

    expect(screen.getByText('القيود المرحلة')).toBeInTheDocument();
  });

  it('should show Total Accounts in Arabic', () => {
    render(<QuickStats isRTL={true} />);

    expect(screen.getByText('إجمالي الحسابات')).toBeInTheDocument();
  });

  it('should show Last Entry in Arabic', () => {
    render(<QuickStats isRTL={true} />);

    expect(screen.getByText('آخر قيد')).toBeInTheDocument();
  });

  it('should display dash as default value', () => {
    render(<QuickStats isRTL={false} />);

    // All values should be '-' by default
    const values = screen.getAllByText('-');
    expect(values.length).toBe(4);
  });

  it('should apply correct grid layout', () => {
    render(<QuickStats isRTL={false} />);

    const grid = document.querySelector('.grid-cols-1');
    expect(grid).toBeInTheDocument();
  });

  it('should have responsive columns', () => {
    render(<QuickStats isRTL={false} />);

    const grid = document.querySelector('.md\\:grid-cols-4');
    expect(grid).toBeInTheDocument();
  });

  it('should apply color to draft entries', () => {
    render(<QuickStats isRTL={false} />);

    const blueValue = document.querySelector('.text-blue-600');
    expect(blueValue).toBeInTheDocument();
  });

  it('should apply color to posted entries', () => {
    render(<QuickStats isRTL={false} />);

    const greenValue = document.querySelector('.text-green-600');
    expect(greenValue).toBeInTheDocument();
  });

  it('should apply color to total accounts', () => {
    render(<QuickStats isRTL={false} />);

    const purpleValue = document.querySelector('.text-purple-600');
    expect(purpleValue).toBeInTheDocument();
  });
});

describe('StatCard (internal component)', () => {
  it('renders properly through QuickStats', () => {
    render(<QuickStats isRTL={false} />);

    // Each card should have CardHeader and CardContent
    const cards = document.querySelectorAll('[class*="Card"]');
    expect(cards.length).toBeGreaterThan(0);
  });
});
