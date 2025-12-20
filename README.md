# 🏭 Wardah ERP - Enterprise Manufacturing System

**نظام وردة المتطور لإدارة التصنيع وتكاليف المراحل**

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat&logo=supabase&logoColor=white)](https://supabase.com/)

---

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

**First time setup?** See [Installation Guide](./docs/getting-started/installation.md)

---

## 📚 Documentation

**📖 [Complete Documentation Index](./docs/INDEX.md)**

### Essential Guides:
- 🚀 [Getting Started](./docs/getting-started/quick-start.md)
- 🗄️ [Database Setup](./docs/deployment/database-setup.md)
- ⚡ [Performance Optimization](./docs/troubleshooting/performance.md)

### Features:
- 📊 [Accounting Module](./docs/features/accounting/README.md)
- 🏭 [Manufacturing](./docs/features/manufacturing/README.md)
- 📦 [Inventory Management](./docs/features/inventory/README.md)
- 👥 [HR Module](./docs/features/hr/README.md)

---

## ✨ Features

### Core Modules
- ✅ **Process Costing** - Advanced stage costing with real-time calculations
- ✅ **Double-Entry Accounting** - Full GL, Trial Balance, Financial Reports
- ✅ **Inventory Management** - AVCO valuation, Stock Movements, Adjustments
- ✅ **Manufacturing Orders** - BOM, Routing, Work Centers, Quality Control
- ✅ **Purchase & Sales** - Invoices, Vouchers, Collections, Payments
- ✅ **HR Management** - Payroll, Attendance, Leaves, Settlements

### Technical Features
- ⚡ **40-60% Performance Improvement** - Optimized with indexes, views, caching
- 🌐 **Bilingual Support** - Full Arabic/English with RTL
- 🔐 **Multi-Tenant** - Organization-based data isolation
- 📱 **Responsive Design** - Works on all devices
- 🎨 **Modern UI** - shadcn/ui components with dark mode

---

## 🛠️ Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **UI**: Tailwind CSS + shadcn/ui
- **State**: Zustand + React Query
- **Backend**: Supabase (PostgreSQL)
- **Forms**: React Hook Form + Zod
- **Charts**: Recharts
- **i18n**: i18next

---

## 📁 Project Structure

```
wardah-process-costing/
├── src/                    # Frontend source code
│   ├── components/         # Reusable components
│   ├── features/           # Feature modules
│   ├── services/           # API services
│   └── lib/               # Utilities
│
├── docs/                   # Documentation
│   ├── getting-started/    # Installation & setup
│   ├── features/          # Feature documentation
│   ├── deployment/        # Deployment guides
│   └── troubleshooting/   # Common issues
│
├── sql/                   # Database scripts
│   ├── migrations/        # Schema migrations
│   ├── functions/         # RPC functions
│   ├── views/             # Database views
│   └── performance/       # Performance scripts
│
├── scripts/                # Automation scripts
│   ├── deploy/            # Deployment scripts
│   ├── check/             # Verification scripts
│   └── import/            # Data import scripts
│
└── tests/                  # Test files
```

---

## 🧪 Testing

```bash
# Run all tests
npm run test

# Run with coverage
npm run test:coverage

# Run specific tests
npm run test -- --filter="process-costing"
```

| Metric | Value |
|--------|-------|
| **Total Tests** | 1862 |
| **Test Files** | 85 |
| **Status** | ✅ All Passing |

**Key Test Areas:**
- Process Costing Service (29 tests)
- Organization & Multi-Tenant (21 tests)
- RBAC Permissions (16 tests)
- Stock Adjustments (20 tests)
- UI Components (200+ tests)

**See [Testing Strategy](./docs/testing-strategy.md) for details**

---

## 🎯 Performance

| Module | Load Time | Status |
|--------|-----------|--------|
| Manufacturing Orders | **385ms** | ⚡ Fast |
| Journal Entries | **407ms** | ⚡ Fast |
| Trial Balance | **400ms** | ⚡ Fast |

**See [Performance Guide](./docs/troubleshooting/performance.md) for details**

---

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## 📞 Support

- 📖 [Full Documentation](./docs/INDEX.md)
- 🐛 [Report Issues](https://github.com/6thd/wardah-process-costing/issues)
- 💬 [Discussions](https://github.com/6thd/wardah-process-costing/discussions)

---

## 📄 License

See [LICENSE](./LICENSE) file for details.

---

## 🎉 Acknowledgments

Built with ❤️ for the manufacturing industry.

**Status:** ✅ Production Ready | **Version:** 2.0.0
