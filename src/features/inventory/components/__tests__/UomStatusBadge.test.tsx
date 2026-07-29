import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { UomStatusBadge } from '../UomStatusBadge'

describe('UomStatusBadge', () => {
  it('links to the repair screen by default', () => {
    render(
      <MemoryRouter>
        <UomStatusBadge />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: /يحتاج إعداد وحدة/ })
    expect(link).toHaveAttribute('href', '/inventory/uom-issues')
  })

  it('renders a plain badge without a link when withLink is false', () => {
    render(
      <MemoryRouter>
        <UomStatusBadge withLink={false} />
      </MemoryRouter>,
    )
    expect(screen.getByText('يحتاج إعداد وحدة')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
