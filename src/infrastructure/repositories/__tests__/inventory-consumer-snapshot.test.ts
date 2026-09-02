import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// This deliberately pins the discovery snapshot. A follow-up that retires or
// rewrites a consumer must supersede the audit and update this contract.
const read = (path: string) => readFileSync(path, 'utf8')

const count = (source: string, token: string) => source.split(token).length - 1

// Mirrors scripts/ci/fresh-db/resolve_baseline_pair.sh's no-cutoff-arg
// selection (`find ... -name '000_schema_baseline_*.sql' | sort | tail -1`):
// once another Baseline pair is generated, this test must inspect the
// current one, not the dated file recorded when it was written.
const resolveLatestBaseline = () => {
  const dir = 'sql/baseline'
  const latest = readdirSync(dir)
    .filter((name) => /^000_schema_baseline_.*\.sql$/.test(name))
    .sort()
    .at(-1)
  if (!latest) throw new Error(`no 000_schema_baseline_*.sql found in ${dir}`)
  return `${dir}/${latest}`
}

describe('Round 3 inventory consumer snapshot', () => {
  const generatedTypes = read('src/types/database.generated.ts')
  const currentBaseline = read(resolveLatestBaseline())

  it('pins the canonical relations and bins valuation column', () => {
    expect(generatedTypes).not.toMatch(/^      stock_movements: \{/m)
    expect(generatedTypes).not.toMatch(/^      stock_moves: \{/m)
    expect(currentBaseline).not.toMatch(/^CREATE TABLE public\.stock_movements\b/m)
    expect(currentBaseline).not.toMatch(/^CREATE TABLE public\.stock_moves\b/m)

    const binsStart = generatedTypes.indexOf('      bins: {')
    const binsEnd = generatedTypes.indexOf('      bom_alternatives: {', binsStart)
    expect(binsStart).toBeGreaterThanOrEqual(0)
    expect(binsEnd).toBeGreaterThan(binsStart)

    const binsContract = generatedTypes.slice(binsStart, binsEnd)
    expect(binsContract).toContain('valuation_rate')
    expect(binsContract).not.toContain('avg_rate')
  })

  it('pins the two stale stock_movements calls and four bins.avg_rate references', () => {
    const repository = read('src/infrastructure/repositories/SupabaseInventoryRepository.ts')

    expect(count(repository, ".from('stock_movements')")).toBe(2)
    expect(count(repository, 'avg_rate')).toBe(4)
  })

  it('keeps the stock_moves browser write classified as a development fallback', () => {
    const salesService = read('src/services/enhanced-sales-service.ts')

    expect(count(salesService, ".from('stock_moves')")).toBe(1)
    expect(salesService).toContain('if (import.meta.env.PROD)')
    expect(salesService.indexOf('if (import.meta.env.PROD)')).toBeLessThan(
      salesService.indexOf('const deliveryNumber = await generateDeliveryNumber()')
    )
  })

  it('keeps the legacy JavaScript stack outside the active Vite entrypoint', () => {
    const indexHtml = read('index.html')
    const legacyMain = read('js/main.js')
    const legacyModules = [
      'js/modules/inventory.js',
      'js/modules/purchasing.js',
      'js/modules/sales.js',
      'js/modules/processCosting.js',
    ].map(read).join('\n')

    expect(indexHtml).toContain('/src/main.tsx')
    expect(indexHtml).not.toContain('/js/main.js')
    expect(legacyMain).toContain("from './modules/inventory.js'")
    expect(count(legacyModules, '.from(T.stock_moves)')).toBe(9)
  })

  it('distinguishes the valid simulate_cogs result field from bins.avg_rate', () => {
    const valuationRepository = read(
      'src/infrastructure/repositories/SupabaseInventoryValuationRepository.ts'
    )

    expect(generatedTypes).toMatch(
      /simulate_cogs:[\s\S]*?Returns: \{[\s\S]*?avg_rate: number/
    )
    expect(valuationRepository).toContain(".rpc('simulate_cogs'")
  })
})
