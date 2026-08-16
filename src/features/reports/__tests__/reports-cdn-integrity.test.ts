import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readRepositoryFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8')

const publicHtml = readRepositoryFile('src/features/reports/public/index.html')
const publicDashboardCss = readRepositoryFile(
  'src/features/reports/public/styles/dashboard.css',
)
const componentDashboardCss = readRepositoryFile(
  'src/features/reports/components/dashboard/styles.css',
)
const componentSource = readRepositoryFile(
  'src/features/reports/components/dashboard/GeminiDashboard.tsx',
)
const fontAwesomeSri =
  'sha384-3B6NwesSXE7YJlcLI9RpRqGf2p/EgVH8BgoKTaUrmKNDkHPStTQ3EyoYjCGXaOTS'

describe('Reports dashboard CDN integrity', () => {
  it('protects every version-pinned CDN asset in the standalone page with SRI', () => {
    const cdnTags = publicHtml.match(
      /<(?:link|script)\b[^>]*(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)[^>]*>/gi,
    )

    expect(cdnTags).not.toBeNull()
    expect(cdnTags).not.toHaveLength(0)

    for (const tag of cdnTags ?? []) {
      expect(tag).toMatch(/\bintegrity="sha384-[A-Za-z0-9+/=]+"/i)
      expect(tag).toMatch(/\bcrossorigin="anonymous"/i)
    }

    const fontAwesomeTag = cdnTags?.find((tag) => tag.includes('font-awesome/6.0.0'))
    expect(fontAwesomeTag).toContain(`integrity="${fontAwesomeSri}"`)
  })

  it('does not bypass SRI by importing Font Awesome again from CSS', () => {
    expect(publicDashboardCss).not.toContain('cdnjs.cloudflare.com/ajax/libs/font-awesome')
    expect(componentDashboardCss).not.toContain('cdnjs.cloudflare.com/ajax/libs/font-awesome')
  })

  it('bundles the installed Font Awesome package for the React dashboard', () => {
    expect(componentSource).toContain(
      "import '@fortawesome/fontawesome-free/css/all.min.css'",
    )
  })
})
