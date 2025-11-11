import { useEffect } from 'react'

/**
 * Adds Excel-like keyboard navigation for a table of inputs.
 * Arrow keys move between cells, Enter adds a new row, Delete clears cell.
 */
export const useKeyboardNav = (
  tableRef: React.RefObject<HTMLTableElement>,
) => {
  useEffect(() => {
    const table = tableRef.current
    if (!table) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement

      // Allow components to opt-out from table navigation
      if (target?.dataset?.disableNav === 'true') {
        return
      }

      const cell = target?.closest('td') as HTMLTableCellElement | null
      if (!cell) return

      const row = cell.parentElement as HTMLTableRowElement
      const body = row?.parentElement
      if (!row || !body) return

      const rows = Array.from(body.children) as HTMLTableRowElement[]
      const rowIndex = rows.indexOf(row)
      const cells = Array.from(row.children) as HTMLTableCellElement[]
      const cellIndex = cells.indexOf(cell)

      const focusCell = (nextCell: HTMLTableCellElement | undefined | null) => {
        if (!nextCell) return
        const input = nextCell.querySelector('input,button,select,textarea') as HTMLElement | null
        if (input) {
          input.focus()
          if (input instanceof HTMLInputElement) {
            input.select()
          }
        }
      }

      switch (event.key) {
        case 'ArrowRight': {
          focusCell(cells[cellIndex + 1])
          event.preventDefault()
          break
        }
        case 'ArrowLeft': {
          focusCell(cells[cellIndex - 1])
          event.preventDefault()
          break
        }
        case 'ArrowDown': {
          const nextRow = rows[rowIndex + 1]
          focusCell(nextRow?.children[cellIndex] as HTMLTableCellElement | undefined)
          event.preventDefault()
          break
        }
        case 'ArrowUp': {
          const prevRow = rows[rowIndex - 1]
          focusCell(prevRow?.children[cellIndex] as HTMLTableCellElement | undefined)
          event.preventDefault()
          break
        }
        case 'Enter': {
          const addButton = document.querySelector('[data-add-line]') as HTMLButtonElement | null
          if (addButton) {
            event.preventDefault()
            addButton.click()
            setTimeout(() => {
              const updatedTable = tableRef.current
              if (!updatedTable) return
              const bodies = updatedTable.tBodies
              const lastBody = bodies[bodies.length - 1]
              const lastRow = lastBody?.rows[lastBody.rows.length - 1]
              const firstCell = lastRow?.cells[0]
              focusCell(firstCell as HTMLTableCellElement | undefined)
            }, 50)
          }
          break
        }
        case 'Delete': {
          if (target instanceof HTMLInputElement) {
            if (target.value !== '') {
              target.value = ''
              target.dispatchEvent(new Event('input', { bubbles: true }))
              event.preventDefault()
            }
          }
          break
        }
        default:
          break
      }
    }

    table.addEventListener('keydown', handleKeyDown)
    return () => {
      table.removeEventListener('keydown', handleKeyDown)
    }
  }, [tableRef])
}
