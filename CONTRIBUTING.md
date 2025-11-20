# 🤝 Contributing to Wardah ERP

شكراً لاهتمامك بالمساهمة في مشروع Wardah ERP!

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)

---

## 📜 Code of Conduct

### Our Standards

- ✅ Be respectful and inclusive
- ✅ Welcome newcomers
- ✅ Focus on constructive feedback
- ✅ Respect different viewpoints

### Unacceptable Behavior

- ❌ Harassment or discrimination
- ❌ Trolling or insulting comments
- ❌ Personal attacks

---

## 🚀 Getting Started

### 1. Fork & Clone

```bash
# Fork the repository on GitHub
# Then clone your fork
git clone https://github.com/YOUR_USERNAME/wardah-process-costing.git
cd wardah-process-costing
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

---

## 💻 Development Workflow

### 1. Make Changes

- Write clean, readable code
- Follow TypeScript best practices
- Add comments for complex logic
- Update documentation if needed

### 2. Test Your Changes

```bash
# Run tests
npm test

# Check linting
npm run lint

# Type check
npm run type-check
```

### 3. Commit Your Changes

Follow our [commit guidelines](#commit-guidelines).

### 4. Push & Create PR

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

---

## 📝 Coding Standards

### TypeScript

- ✅ Use TypeScript for all new code
- ✅ Define proper types/interfaces
- ✅ Avoid `any` type
- ✅ Use meaningful variable names

### React Components

```typescript
// ✅ Good
interface Props {
  title: string;
  onSave: () => void;
}

export const MyComponent: React.FC<Props> = ({ title, onSave }) => {
  // Component logic
};

// ❌ Bad
export const MyComponent = (props: any) => {
  // ...
};
```

### File Structure

```
src/
├── features/
│   └── module-name/
│       ├── index.tsx          # Main component
│       ├── components/        # Sub-components
│       ├── hooks/             # Custom hooks
│       └── services/         # API services
```

### Naming Conventions

- **Components**: PascalCase (`UserProfile.tsx`)
- **Files**: kebab-case (`user-profile.tsx`)
- **Functions**: camelCase (`getUserData`)
- **Constants**: UPPER_SNAKE_CASE (`API_BASE_URL`)

---

## 📦 Commit Guidelines

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code style (formatting)
- `refactor`: Code refactoring
- `perf`: Performance improvement
- `test`: Adding tests
- `chore`: Maintenance tasks

### Examples

```bash
# Good commits
feat(accounting): add trial balance export
fix(manufacturing): resolve BOM calculation error
docs(readme): update installation guide
refactor(services): simplify API calls

# Bad commits
fix bug
update
changes
```

---

## 🔄 Pull Request Process

### Before Submitting

- [ ] Code follows style guidelines
- [ ] Tests pass locally
- [ ] Documentation updated
- [ ] No console.logs or debug code
- [ ] Commit messages follow guidelines

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How was this tested?

## Screenshots (if applicable)
Add screenshots here
```

### Review Process

1. **Automated Checks** - CI/CD will run tests
2. **Code Review** - Maintainers will review
3. **Feedback** - Address any comments
4. **Merge** - Once approved, it will be merged

---

## 🐛 Reporting Bugs

### Bug Report Template

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce:
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment:**
- OS: [e.g. Windows 10]
- Browser: [e.g. Chrome 120]
- Version: [e.g. 2.0.0]
```

---

## 💡 Feature Requests

### Feature Request Template

```markdown
**Is your feature request related to a problem?**
A clear description of the problem.

**Describe the solution you'd like**
What you want to happen.

**Describe alternatives you've considered**
Other solutions you've thought about.

**Additional context**
Any other information.
```

---

## 📚 Documentation

### When to Update Docs

- ✅ Adding new features
- ✅ Changing API/function signatures
- ✅ Fixing bugs that affect usage
- ✅ Adding new dependencies

### Documentation Standards

- Use clear, concise language
- Include code examples
- Add screenshots when helpful
- Keep docs/INDEX.md updated

---

## 🎯 Areas for Contribution

### High Priority:
- 🐛 Bug fixes
- 📚 Documentation improvements
- ⚡ Performance optimizations
- 🧪 Test coverage

### Medium Priority:
- 🎨 UI/UX improvements
- 🔧 Code refactoring
- 🌐 i18n translations
- 📊 New reports

### Low Priority:
- 🎨 Theme customization
- 📱 Mobile optimizations
- 🔌 Plugin system

---

## ❓ Questions?

- 💬 [GitHub Discussions](https://github.com/6thd/wardah-process-costing/discussions)
- 📧 Email: support@wardah-erp.sa
- 📖 [Documentation](./docs/INDEX.md)

---

## 🙏 Thank You!

Your contributions make Wardah ERP better for everyone!

**Happy Coding! 🚀**
