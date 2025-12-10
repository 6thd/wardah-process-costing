# NOSONAR Comments Tracking

## Overview
This document tracks all NOSONAR comments in the codebase for technical debt management.

**Goal**: Zero NOSONAR comments in production code by Week 5

---

## Current NOSONAR Comments

### Security Tests (`tests/core/security.test.ts`)

#### 1. Email Regex (Line 53)
- **Rule**: S5852 (ReDoS vulnerability)
- **Location**: `validateInput.email()` function
- **Reason**: 
  - Length is checked before regex (max 254 chars prevents ReDoS)
  - No nested quantifiers in this pattern
  - Test-only code, not production
- **Status**: ⏳ TODO - Week 4
- **Action Plan**:
  - [ ] Replace with zod/yup validation library
  - [ ] Or use built-in HTML5 validation
  - [ ] Remove NOSONAR after refactoring

#### 2. UUID Regex (Line 41)
- **Rule**: S5852 (ReDoS vulnerability)
- **Location**: `isValidUUID()` function
- **Reason**:
  - Fixed length (36 chars) prevents ReDoS
  - No nested quantifiers
  - Length checked before regex
- **Status**: ⏳ TODO - Week 4
- **Action Plan**:
  - [ ] Consider using `uuid` library for validation
  - [ ] Or keep current implementation (safe due to fixed length)
  - [ ] Review and decide in Week 4

#### 3. Code Regex (Line 70)
- **Rule**: S5852 (ReDoS vulnerability)
- **Location**: `validateInput.code()` function
- **Reason**:
  - Length checked (2-20 chars) before regex
  - No nested quantifiers
  - Bounded range prevents ReDoS
- **Status**: ⏳ TODO - Week 4
- **Action Plan**:
  - [ ] Replace with zod schema validation
  - [ ] Or keep if performance is acceptable
  - [ ] Review in Week 4

---

## Week 4 Cleanup Plan

### Checklist

- [ ] Review all NOSONAR comments
- [ ] Identify false positives vs real issues
- [ ] Replace regex patterns with safer alternatives
- [ ] Use validation libraries (zod/yup) where appropriate
- [ ] Remove NOSONAR comments after fixes
- [ ] Verify SonarQube is clean
- [ ] Update this document

### Priority

1. **High Priority**: Production code NOSONAR comments
2. **Medium Priority**: Test code with security implications
3. **Low Priority**: Test-only code (can keep if justified)

---

## Best Practices

### When to Use NOSONAR

✅ **Good Use Cases**:
- False positives
- Test-only code (with justification)
- Legacy code (temporary, with TODO)
- Third-party limitations
- With clear documentation and TODO

❌ **Bad Use Cases**:
- "I'm too lazy to fix it"
- "I don't understand the issue"
- "It works, leave it"
- Without explanation or TODO

### NOSONAR Comment Template

```typescript
// NOSONAR S1234: [Specific reason]
// Context: [Why this is OK]
// TODO: [How to fix it properly] (Week X / Issue #XXX)
```

---

## Statistics

- **Total NOSONAR Comments**: 3
- **In Production Code**: 0
- **In Test Code**: 3
- **With TODO**: 3
- **Target**: 0 by Week 5

---

## Last Updated
2024-12-10 - Week 1 (Security Tests)

