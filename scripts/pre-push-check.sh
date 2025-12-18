#!/bin/bash
# pre-push-check.sh - Run all quality checks before pushing

set -e  # Exit on first error

echo "🔍 Running code quality checks..."
echo ""

# 1. TypeScript Type Check
echo "📘 TypeScript Type Check..."
if ! npm run type-check; then
  echo "❌ TypeScript check failed!"
  exit 1
fi
echo "✅ TypeScript check passed"
echo ""

# 2. ESLint
echo "🔎 Running ESLint..."
if ! npm run lint -- --max-warnings 50; then
  echo "❌ ESLint check failed! Too many warnings."
  exit 1
fi
echo "✅ ESLint check passed"
echo ""

# 3. Tests
echo "🧪 Running tests..."
if ! npm test; then
  echo "❌ Tests failed!"
  exit 1
fi
echo "✅ Tests passed"
echo ""

# 4. Build
echo "🏗️ Building..."
if ! npm run build; then
  echo "❌ Build failed!"
  exit 1
fi
echo "✅ Build succeeded"
echo ""

echo "======================================"
echo "✅ All quality checks passed!"
echo "======================================"
