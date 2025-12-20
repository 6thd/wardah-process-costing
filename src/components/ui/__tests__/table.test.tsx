/**
 * Table Component Tests
 * ======================
 * Tests for the Table UI components
 * 
 * @module components/ui/__tests__/table.test
 * @created 18 December 2025
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from '../table'

describe('Table Component', () => {
  describe('Table', () => {
    it('should render table element', () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLTableElement | null }
      render(
        <Table ref={ref}>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(ref.current).toBeInstanceOf(HTMLTableElement)
    })

    it('should have correct display name', () => {
      expect(Table.displayName).toBe('Table')
    })

    it('should have base styling classes', () => {
      render(
        <Table data-testid="table">
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(screen.getByRole('table')).toHaveClass('w-full', 'caption-bottom', 'text-sm')
    })

    it('should merge custom className', () => {
      render(
        <Table className="custom-table">
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(screen.getByRole('table')).toHaveClass('custom-table')
    })

    it('should be wrapped in overflow container', () => {
      render(
        <Table data-testid="table">
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      const wrapper = screen.getByRole('table').parentElement
      expect(wrapper).toHaveClass('relative', 'w-full', 'overflow-auto')
    })
  })

  describe('TableHeader', () => {
    it('should render thead element', () => {
      render(
        <Table>
          <TableHeader data-testid="header">
            <TableRow>
              <TableHead>Column</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
      )
      expect(screen.getByTestId('header').tagName).toBe('THEAD')
    })

    it('should have correct display name', () => {
      expect(TableHeader.displayName).toBe('TableHeader')
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLTableSectionElement | null }
      render(
        <Table>
          <TableHeader ref={ref}>
            <TableRow>
              <TableHead>Column</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
      )
      expect(ref.current).toBeInstanceOf(HTMLTableSectionElement)
    })

    it('should have border styling', () => {
      render(
        <Table>
          <TableHeader data-testid="header">
            <TableRow>
              <TableHead>Column</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
      )
      expect(screen.getByTestId('header')).toHaveClass('[&_tr]:border-b')
    })
  })

  describe('TableBody', () => {
    it('should render tbody element', () => {
      render(
        <Table>
          <TableBody data-testid="body">
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(screen.getByTestId('body').tagName).toBe('TBODY')
    })

    it('should have correct display name', () => {
      expect(TableBody.displayName).toBe('TableBody')
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLTableSectionElement | null }
      render(
        <Table>
          <TableBody ref={ref}>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(ref.current).toBeInstanceOf(HTMLTableSectionElement)
    })

    it('should have last-child border styling', () => {
      render(
        <Table>
          <TableBody data-testid="body">
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(screen.getByTestId('body')).toHaveClass('[&_tr:last-child]:border-0')
    })
  })

  describe('TableFooter', () => {
    it('should render tfoot element', () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter data-testid="footer">
            <TableRow>
              <TableCell>Footer</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )
      expect(screen.getByTestId('footer').tagName).toBe('TFOOT')
    })

    it('should have correct display name', () => {
      expect(TableFooter.displayName).toBe('TableFooter')
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLTableSectionElement | null }
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter ref={ref}>
            <TableRow>
              <TableCell>Footer</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )
      expect(ref.current).toBeInstanceOf(HTMLTableSectionElement)
    })

    it('should have muted background styling', () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter data-testid="footer">
            <TableRow>
              <TableCell>Footer</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )
      expect(screen.getByTestId('footer')).toHaveClass('bg-muted/50', 'font-medium')
    })
  })

  describe('TableRow', () => {
    it('should render tr element', () => {
      render(
        <Table>
          <TableBody>
            <TableRow data-testid="row">
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(screen.getByTestId('row').tagName).toBe('TR')
    })

    it('should have correct display name', () => {
      expect(TableRow.displayName).toBe('TableRow')
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLTableRowElement | null }
      render(
        <Table>
          <TableBody>
            <TableRow ref={ref}>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(ref.current).toBeInstanceOf(HTMLTableRowElement)
    })

    it('should have hover styling', () => {
      render(
        <Table>
          <TableBody>
            <TableRow data-testid="row">
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(screen.getByTestId('row')).toHaveClass('hover:bg-muted/50')
    })

    it('should have selected state styling', () => {
      render(
        <Table>
          <TableBody>
            <TableRow data-testid="row">
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(screen.getByTestId('row')).toHaveClass('data-[state=selected]:bg-muted')
    })

    it('should have transition styling', () => {
      render(
        <Table>
          <TableBody>
            <TableRow data-testid="row">
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(screen.getByTestId('row')).toHaveClass('transition-colors')
    })
  })

  describe('TableHead', () => {
    it('should render th element', () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead data-testid="head">Column</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
      )
      expect(screen.getByTestId('head').tagName).toBe('TH')
    })

    it('should have correct display name', () => {
      expect(TableHead.displayName).toBe('TableHead')
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLTableCellElement | null }
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead ref={ref}>Column</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
      )
      expect(ref.current).toBeInstanceOf(HTMLTableCellElement)
    })

    it('should have header styling', () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead data-testid="head">Column</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
      )
      expect(screen.getByTestId('head')).toHaveClass('h-12', 'px-4', 'font-medium', 'text-muted-foreground')
    })
  })

  describe('TableCell', () => {
    it('should render td element', () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell data-testid="cell">Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(screen.getByTestId('cell').tagName).toBe('TD')
    })

    it('should have correct display name', () => {
      expect(TableCell.displayName).toBe('TableCell')
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLTableCellElement | null }
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell ref={ref}>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(ref.current).toBeInstanceOf(HTMLTableCellElement)
    })

    it('should have cell styling', () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell data-testid="cell">Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(screen.getByTestId('cell')).toHaveClass('p-4', 'align-middle')
    })
  })

  describe('TableCaption', () => {
    it('should render caption element', () => {
      render(
        <Table>
          <TableCaption data-testid="caption">Table Caption</TableCaption>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(screen.getByTestId('caption').tagName).toBe('CAPTION')
    })

    it('should have correct display name', () => {
      expect(TableCaption.displayName).toBe('TableCaption')
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLTableCaptionElement | null }
      render(
        <Table>
          <TableCaption ref={ref}>Caption</TableCaption>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(ref.current).toBeInstanceOf(HTMLTableCaptionElement)
    })

    it('should have caption styling', () => {
      render(
        <Table>
          <TableCaption data-testid="caption">Caption</TableCaption>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      expect(screen.getByTestId('caption')).toHaveClass('mt-4', 'text-sm', 'text-muted-foreground')
    })
  })

  describe('Complete Table Composition', () => {
    it('should render complete table with all components', () => {
      render(
        <Table>
          <TableCaption>A list of products</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Quantity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Product A</TableCell>
              <TableCell>$100</TableCell>
              <TableCell>10</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Product B</TableCell>
              <TableCell>$200</TableCell>
              <TableCell>5</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>Total</TableCell>
              <TableCell>15</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )

      expect(screen.getByText('A list of products')).toBeInTheDocument()
      expect(screen.getByText('Name')).toBeInTheDocument()
      expect(screen.getByText('Product A')).toBeInTheDocument()
      expect(screen.getByText('Total')).toBeInTheDocument()
    })

    it('should render data table with multiple rows', () => {
      const data = [
        { id: 1, name: 'Item 1', value: 100 },
        { id: 2, name: 'Item 2', value: 200 },
        { id: 3, name: 'Item 3', value: 300 },
      ]

      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.id}</TableCell>
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )

      expect(screen.getAllByRole('row')).toHaveLength(4) // 1 header + 3 data rows
      expect(screen.getByText('Item 1')).toBeInTheDocument()
      expect(screen.getByText('Item 2')).toBeInTheDocument()
      expect(screen.getByText('Item 3')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('should have proper table structure', () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Header</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      expect(screen.getByRole('table')).toBeInTheDocument()
      expect(screen.getByRole('columnheader')).toBeInTheDocument()
      expect(screen.getByRole('cell')).toBeInTheDocument()
    })

    it('should support aria-label on table', () => {
      render(
        <Table aria-label="Products table">
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      expect(screen.getByRole('table')).toHaveAttribute('aria-label', 'Products table')
    })

    it('should support scope attribute on TableHead', () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Column Header</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
      )

      expect(screen.getByRole('columnheader')).toHaveAttribute('scope', 'col')
    })
  })
})
