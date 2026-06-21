# Changelog

## [2.0.0] - Zero-Knowledge Encryption Release

### 🔒 Security - Major Breaking Changes

**IMPORTANT:** This release introduces mandatory encryption for all data. Existing users will be prompted to set a master password on first launch, and their data will be automatically migrated to an encrypted format.

#### Added

- **Zero-Knowledge Envelope Encryption**
  - Master password-based encryption with Argon2id key derivation (64MB memory, 3 iterations, parallelism 4)
  - AES-256-GCM envelope encryption for database encryption keys
  - SQLCipher integration replacing unencrypted better-sqlite3
  - Automatic migration from unencrypted to encrypted database with secure deletion of plaintext data
  - Machine-bound AES-256-GCM encryption for API key fallback storage (replaces base64 encoding)

- **Tamper Detection & Data Integrity**
  - HMAC-SHA256 row signing for all financial data (transactions, budgets, goals, categories)
  - Per-table signing keys derived via HKDF from master signing key
  - Integrity verification system with warnings table
  - Manual integrity scan feature in Settings
  - Automatic HMAC backfill for existing records during migration

- **Secure Memory Management**
  - Sensitive keys stored in Node Buffer objects with immediate zeroing after use
  - KEK and DEK cleared from memory on app lock/quit
  - Transient key handling—master password never persisted

- **Electron Security Hardening**
  - Enabled renderer sandbox (`sandbox: true`)
  - Content Security Policy restricting resources to `'self'`
  - Zod schema validation for all IPC payloads
  - Strict IPC channel allowlist (no wildcard handlers)

- **UI Components**
  - Encryption setup flow with password strength indicator
  - Unlock screen with master password entry
  - Integrity warnings panel in Settings
  - Security section in Settings with password change functionality

#### Changed

- Database file location: `%APPDATA%\BudgetApp\data.db` → `%APPDATA%\BudgetApp\data_encrypted.db`
- All database operations now require unlocked keystore
- IPC handlers updated to compute and verify HMAC signatures on write/read operations
- App initialization flow now checks encryption state before loading main UI

#### Added Files

- `src/main/crypto/keyManager.ts` - Master password, KEK/DEK management, Argon2id derivation
- `src/main/crypto/integrity.ts` - HMAC signing and verification for financial data
- `src/main/db/migration.ts` - Database migration and SQLCipher initialization
- `src/main/ipc/encryption-handlers.ts` - IPC handlers for encryption operations with Zod validation
- `src/main/database-encrypted.ts` - Encrypted database wrapper replacing database.ts
- `src/renderer/src/components/auth/encryption-setup.tsx` - First-time encryption setup UI
- `src/renderer/src/components/auth/unlock-screen.tsx` - Master password unlock UI
- `src/renderer/src/components/integrity/integrity-panel.tsx` - Integrity verification UI
- `src/main/crypto/__tests__/keyManager.test.ts` - Unit tests for crypto operations

#### Security Notes

- **No Password Recovery:** If you forget your master password, your data cannot be recovered. Use a strong, memorable password or a password manager.
- **Local-Only Encryption:** All encryption happens locally. No cloud KMS, no telemetry, no external dependencies.
- **Migration Safety:** Original unencrypted database is securely deleted (overwritten with random data before unlink) after successful migration.

#### Dependencies Added

- `argon2` - Password hashing and key derivation
- `better-sqlite3-multiple-ciphers` - SQLCipher support for encrypted database
- `zod` - Runtime type validation for IPC payloads

---

## UI Modernization - Premium App Experience

### Visual Language Refresh

**Glassmorphism Design System**
- Implemented semi-transparent glassmorphism cards with backdrop-blur effects across Dashboard summary cards
- Added subtle animated gradient background (CSS-only, no external assets) that shifts smoothly over 15 seconds
- Applied consistent glass-card styling using Tailwind utilities (`backdrop-blur-xl`, `bg-white/10` in light mode, `bg-black/20` in dark mode)
- All glassmorphism respects existing light/dark theme tokens for seamless integration

**Dark Mode by Default**
- Changed default theme from 'system' to 'dark' for a modern, premium feel
- Created animated theme toggle component with smooth sun/moon icon morphing using Framer Motion
- Toggle persists to local settings and appears in the app header for easy access
- Maintains full accessibility with keyboard navigation support

**Loading & Empty States**
- Replaced blank loading states with shadcn/ui Skeleton components across Dashboard, Budget, Analytics, and Transaction pages
- Designed custom empty state illustrations as inline SVG (hand-drawn/line-art style) for:
  - Transactions (list with dots)
  - Goals (checklist with progress)
  - Charts (bar graph)
  - Wallet (wallet icon)
  - Default (clock)
- Each empty state includes animated SVG paths that draw on mount, plus clear CTA buttons

### Micro-interactions & Animations

**Animated Numeric Values**
- All numeric displays (net worth, spending totals, savings rate) now count up/down smoothly using Framer Motion's `useSpring` and `useMotionValue`
- Numbers transition naturally when data changes instead of snapping instantly
- Consistent spring physics configuration defined in shared motion library

**Budget Overspend Interactions**
- Category cards that exceed budget trigger a one-time shake animation using `useAnimationControls`
- Overspent cards shift to glassmorphism style with destructive color tint (`glass-card border-destructive/30 bg-destructive/5`)
- Spending amount text turns red and displays "over budget" instead of "left"
- Shake animation only triggers when transitioning from under to over budget

**Hover Lift Effects**
- All clickable cards (stat tiles, budget categories, dashboard charts) have consistent hover micro-interactions
- Scale to 1.02 with subtle upward translation and shadow increase
- Timing and easing defined once in `src/renderer/src/lib/motion.ts` for consistency
- Applied via shared `cardHoverVariants` configuration

### Advanced Data Visualization

**Enhanced Recharts Integration**
- Migrated all charts to use gradient area fills with smooth animated entry
- Bar charts use linear gradients (income: green, expenses: red, savings: blue) with opacity transitions
- Area chart for savings rate trend with gradient fill from primary color
- All charts respect Tailwind CSS variables and shadcn theme tokens (no hardcoded colors)
- Consistent animation timing: 800-1000ms duration with staggered delays for multiple series
- Rounded tooltips with proper theming

**Daily Spending Heatmap Calendar**
- Built custom GitHub-style contributions calendar for Analytics page
- Grid of days color-coded by spending intensity (5 levels from muted to full primary color)
- Hover tooltips show date and spending amount with smooth fade-in animation
- Displays summary stats: total days with spending and peak spending day
- Fully responsive with proper week/day layout
- Animated grid appearance using stagger container pattern

### Performance & Architecture

**Shared Motion Configuration**
- Created `src/renderer/src/lib/motion.ts` with centralized animation constants:
  - Timing: fast (0.15s), standard (0.25s), slow (0.4s), number (0.6s)
  - Easing curves: out, in, inOut, spring
  - Spring configs: gentle, snappy, bouncy
  - Reusable variants: cardHover, fadeInUp, fadeInRight, scaleIn, shake, stagger
- All components import from this single source of truth
- Ensures consistent feel across the entire application

**Adaptive Accent Theme**
- Implemented dynamic accent color system that shifts based on monthly budget status
- Three states:
  - Under budget: Calm blue (hue: 217, sat: 91%)
  - Near budget (>75-80%): Amber warning (hue: 38, sat: 90%)
  - Over budget (>90-100%): Red alert (hue: 15, sat: 85%)
- Applied at app shell level via CSS custom properties (`--accent-hue`, `--accent-sat`)
- Affects all primary-colored elements cohesively (buttons, progress rings, charts)
- Recalculates on month/year change for real-time feedback

### Technical Details

**Dependencies**
- No new external dependencies added
- All animations use existing Framer Motion
- Charts use existing Recharts library
- Glassmorphism uses Tailwind's built-in backdrop-blur utilities
- System fonts only (no CDN font dependencies)

**Accessibility**
- Maintained sufficient contrast ratios in both light and dark themes
- All interactive elements remain keyboard-navigable
- Focus-visible states preserved with ring indicators
- Animated elements respect reduced-motion preferences (Framer Motion default)

**Offline Reliability**
- All assets bundled (no external CDN dependencies)
- Gradient backgrounds are pure CSS
- SVG illustrations are inline code
- Works fully offline as required

### Files Modified

**New Files:**
- `src/renderer/src/lib/motion.ts` - Shared animation configuration
- `src/renderer/src/components/shared/theme-toggle.tsx` - Animated theme switcher
- `src/renderer/src/components/shared/spending-heatmap.tsx` - Daily spending calendar

**Modified Files:**
- `src/renderer/src/styles/globals.css` - Glassmorphism utilities, gradient background, adaptive accent variables
- `src/renderer/src/App.tsx` - Theme toggle integration, adaptive accent logic, dark mode default
- `src/renderer/src/store/app-store.ts` - Default theme changed to 'dark'
- `src/renderer/src/components/shared/stat-tile.tsx` - Animated numbers, glassmorphism, hover effects
- `src/renderer/src/components/shared/empty-state.tsx` - Inline SVG illustrations, enhanced animations
- `src/renderer/src/pages/dashboard.tsx` - Recharts gradients, glassmorphism cards, hover effects
- `src/renderer/src/pages/budget.tsx` - Overspend shake animation, glassmorphism, color shifts
- `src/renderer/src/pages/analytics.tsx` - Daily spending heatmap integration, enhanced charts

### Design Philosophy

This modernization follows the design principles of Linear, Arc Browser, and Raycast:
- **Subtle but delightful**: Animations are fast and purposeful, never gratuitous
- **Consistent motion language**: All transitions use the same timing and easing curves
- **Glassmorphism depth**: Layered transparency creates visual hierarchy without heavy shadows
- **Adaptive feedback**: UI responds to user's financial state with color shifts
- **Performance-first**: Smooth 60fps animations, efficient rendering, no jank

The result is a premium, app-like experience that feels modern and polished while maintaining full offline functionality and accessibility standards.