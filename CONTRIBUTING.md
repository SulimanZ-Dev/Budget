# Contributing to Budget

Thank you for your interest in contributing to Budget! This document provides guidelines and workflows for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Security](#security)
- [Pull Request Process](#pull-request-process)
- [Plugin Development](#plugin-development)

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Report security issues privately (see [Security](#security))

## Getting Started

### Prerequisites

- **Node.js 20+** (LTS recommended)
- **Windows 10/11** (for building native modules)
- **Visual Studio Build Tools** (for better-sqlite3, keytar)
- **Git** for version control

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/budget.git
cd budget

# Install dependencies
npm install

# Start development server
npm run dev
```

### Project Structure

```
Budget/
├── src/
│   ├── main/          # Electron main process
│   │   ├── crypto/    # Encryption, key management
│   │   ├── db/        # Database migration
│   │   ├── ipc/       # IPC handlers
│   │   ├── commands/  # CQRS write operations
│   │   ├── queries/   # CQRS read operations
│   │   ├── events/    # Event sourcing
│   │   ├── plugins/   # Plugin system
│   │   └── services/  # Business logic
│   ├── preload/       # Preload scripts (contextBridge)
│   └── renderer/      # React UI
│       └── src/
│           ├── components/
│           ├── pages/
│           ├── hooks/
│           └── store/
├── .github/
│   └── workflows/     # CI/CD pipelines
├── resources/         # App icons, assets
└── scripts/           # Build scripts
```

## Development Workflow

### Branch Strategy

- `main` - Production-ready code
- `develop` - Integration branch for features
- `feature/*` - New features
- `fix/*` - Bug fixes
- `security/*` - Security patches

### Workflow Steps

1. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes**
   - Write code following our [Coding Standards](#coding-standards)
   - Add tests for new functionality
   - Update documentation as needed

3. **Test locally**
   ```bash
   npm run typecheck  # TypeScript validation
   npm test           # Run test suite
   npm run build      # Build application
   ```

4. **Commit changes**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```
   
   Use [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `style:` - Code style changes (formatting)
   - `refactor:` - Code refactoring
   - `test:` - Adding or updating tests
   - `chore:` - Maintenance tasks
   - `security:` - Security improvements

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

## Coding Standards

### TypeScript

- **Strict mode enabled** - No `any` types without justification
- **Explicit return types** for public functions
- **Interface over type** for object shapes
- **Descriptive names** - `getUserTransactions()` not `getData()`

```typescript
// ✅ Good
interface Transaction {
  id: number
  description: string
  amount: number
}

export function getTransactions(filters?: TransactionFilters): Transaction[] {
  // Implementation
}

// ❌ Bad
export function getData(f?: any): any {
  // Implementation
}
```

### React Components

- **Functional components** with hooks
- **TypeScript props** with interfaces
- **Descriptive component names** - `TransactionList` not `List`
- **Extract reusable logic** into custom hooks

```typescript
// ✅ Good
interface TransactionListProps {
  transactions: Transaction[]
  onSelect: (id: number) => void
}

export function TransactionList({ transactions, onSelect }: TransactionListProps) {
  return (
    <div>
      {transactions.map(tx => (
        <TransactionRow key={tx.id} transaction={tx} onClick={() => onSelect(tx.id)} />
      ))}
    </div>
  )
}
```

### Main Process

- **Never expose Node.js APIs** directly to renderer
- **Validate all IPC inputs** with Zod schemas
- **Use command/query separation** (CQRS pattern)
- **Zero out sensitive buffers** after use

```typescript
// ✅ Good - Validated IPC handler
ipcMain.handle('transactions:create', (_, data) => {
  const validated = TransactionSchema.parse(data)
  return createTransaction(validated)
})

// ❌ Bad - No validation
ipcMain.handle('transactions:create', (_, data) => {
  return db.prepare('INSERT INTO transactions...').run(data)
})
```

### Security Best Practices

1. **Never log sensitive data** (passwords, keys, PII)
2. **Validate all user input** before database operations
3. **Use parameterized queries** to prevent SQL injection
4. **Zero out key material** from memory after use
5. **Follow principle of least privilege** for permissions

## Testing

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode for development
```

### Writing Tests

- **Unit tests** for business logic
- **Integration tests** for IPC handlers
- **Security tests** for encryption/decryption

```typescript
import { describe, it, expect } from 'vitest'

describe('TransactionCommands', () => {
  it('should create transaction with HMAC signature', () => {
    const result = createTransaction({
      description: 'Test',
      amount: 100,
      type: 'expense',
      date: '2024-01-01'
    })
    
    expect(result.id).toBeGreaterThan(0)
    
    // Verify HMAC was computed
    const tx = getTransactionById(result.id)
    expect(tx.hmac).toBeTruthy()
  })
})
```

### Test Coverage

- Aim for **80%+ coverage** on critical paths
- **100% coverage** for security-related code
- Test **edge cases** and **error conditions**

## Security

### Reporting Security Issues

**DO NOT** open public issues for security vulnerabilities.

Instead, email security concerns to: **security@budgetapp.example** (replace with actual email)

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Security Checklist for PRs

- [ ] No hardcoded secrets or API keys
- [ ] All user input validated
- [ ] Sensitive data encrypted at rest
- [ ] Keys zeroed from memory after use
- [ ] No SQL injection vulnerabilities
- [ ] HMAC signatures verified on reads
- [ ] Electron security best practices followed

## Pull Request Process

### Before Submitting

1. **Update documentation** if you changed APIs
2. **Add tests** for new functionality
3. **Run full test suite** and ensure it passes
4. **Check TypeScript** compilation
5. **Update CHANGELOG.md** with your changes

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Manual testing completed
- [ ] No regressions found

## Security
- [ ] No security implications
- [ ] Security review completed (if applicable)

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] Tests pass locally
```

### Review Process

1. **Automated checks** must pass (CI, tests, linting)
2. **Code review** by at least one maintainer
3. **Security review** for security-related changes
4. **Approval** required before merge

### Merge Strategy

- **Squash and merge** for feature branches
- **Rebase and merge** for hotfixes
- **No force pushes** to main/develop

## Plugin Development

See [PLUGINS.md](PLUGINS.md) for comprehensive plugin development guide.

### Quick Start

1. Create plugin directory in `%APPDATA%/BudgetApp/plugins/`
2. Add `plugin.json` manifest
3. Implement `activate()` function
4. Test with hot reload
5. Submit to plugin registry (coming soon)

### Plugin Guidelines

- **Request minimum permissions** needed
- **Handle errors gracefully**
- **Clean up resources** in `deactivate()`
- **Document your plugin** with README
- **Follow semantic versioning**

## Development Tips

### Hot Reload

The app supports hot reload in development:
```bash
npm run dev
```

Changes to renderer code reload automatically. Main process changes require restart.

### Debugging

**Main Process:**
```bash
# Add to launch.json
{
  "type": "node",
  "request": "attach",
  "name": "Attach to Main",
  "port": 9229
}
```

**Renderer Process:**
- Open DevTools: `Ctrl+Shift+I`
- React DevTools available in development

### Database Inspection

```bash
# Open encrypted database (requires master password)
# Use DB Browser for SQLite with SQLCipher support
```

### Common Issues

**Native module build fails:**
```bash
npm install --global windows-build-tools
npm rebuild
```

**TypeScript errors:**
```bash
npm run typecheck
```

**Test failures:**
```bash
npm test -- --reporter=verbose
```

## Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create release branch: `release/v1.x.x`
4. Run full test suite
5. Build installer: `npm run dist`
6. Test installer on clean Windows machine
7. Create GitHub release with changelog
8. Merge to main and tag

## Questions?

- **Documentation:** Check README.md and PLUGINS.md
- **Issues:** Search existing issues or create new one
- **Discussions:** Use GitHub Discussions for questions
- **Security:** Email security@budgetapp.example (private)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to Budget!** 🎉