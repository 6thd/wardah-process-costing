/**
 * Script to check linter errors for a specific file or directory
 * Usage: npm run lint:check -- <file-path>
 * Example: npm run lint:check -- tests/compliance/socpa-compliance.test.ts
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const filePath = process.argv[2]

if (!filePath) {
  console.error('❌ Error: File path is required')
  console.log('Usage: npm run lint:check -- <file-path>')
  console.log('Example: npm run lint:check -- tests/compliance/socpa-compliance.test.ts')
  process.exit(1)
}

const fullPath = join(process.cwd(), filePath)

if (!existsSync(fullPath)) {
  console.error(`❌ Error: File not found: ${filePath}`)
  process.exit(1)
}

console.log(`🔍 Checking linter errors in: ${filePath}\n`)

// Read the file
const content = readFileSync(fullPath, 'utf-8')
const lines = content.split('\n')

// Common SonarQube patterns to check
const patterns = [
  {
    name: 'String#replace() should be replaceAll()',
    regex: /\.replace\([^)]*\/[^)]*\/[^)]*\)/g,
    line: (match: RegExpMatchArray, index: number) => {
      const beforeMatch = content.substring(0, index)
      return beforeMatch.split('\n').length
    },
    check: (line: string) => line.includes('.replace(') && !line.includes('NOSONAR') && !line.includes('replaceAll')
  },
  {
    name: 'Use Math.trunc instead of | 0',
    regex: /\|\s*0/g,
    check: (line: string) => line.includes('| 0') && !line.includes('NOSONAR') && !line.includes('Math.trunc')
  },
  {
    name: 'Don\'t use a zero fraction in the number',
    regex: /\d+\.0+\b/g,
    check: (line: string) => /\d+\.0+\b/.test(line) && !line.includes('NOSONAR')
  },
  {
    name: 'Nested functions more than 4 levels deep',
    check: (line: string, lineNumber: number) => {
      // Simple check: count nested arrow functions
      const arrowFunctionCount = (line.match(/=>/g) || []).length
      return arrowFunctionCount > 0 && !line.includes('NOSONAR')
    }
  }
]

const errors: Array<{ line: number; message: string; code: string }> = []

// Check each line
lines.forEach((line, index) => {
  const lineNumber = index + 1
  
  patterns.forEach((pattern) => {
    if (pattern.check && pattern.check(line, lineNumber)) {
      errors.push({
        line: lineNumber,
        message: pattern.name,
        code: line.trim()
      })
    }
  })
})

if (errors.length > 0) {
  console.log(`❌ Found ${errors.length} potential linter error(s):\n`)
  errors.forEach((error) => {
    console.log(`  Line ${error.line}: ${error.message}`)
    console.log(`    ${error.code.substring(0, 80)}${error.code.length > 80 ? '...' : ''}`)
    console.log()
  })
  console.log('💡 Tip: Add // NOSONAR comment if the issue is acceptable')
  console.log('💡 Or fix the issue before proceeding to the next stage\n')
  process.exit(1)
} else {
  console.log('✅ No linter errors found!\n')
  process.exit(0)
}

