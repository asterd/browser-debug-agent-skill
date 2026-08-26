# Publishing browser-debug-agent

## Prerequisites (one-time)

```bash
# 1. npm account + login
npm login
# Opens browser for authentication. You need publish rights on the 'browser-debug-agent' package.

# 2. GitHub CLI (for tags/releases)
gh auth login
```

## Publish

### Option A: Automated (recommended)

```bash
# Dry run first — verifies everything without publishing
sh publish.sh --dry

# Publish for real
sh publish.sh
```

The script:
1. Checks npm auth and clean git state
2. Builds the core
3. Runs all 29 unit tests
4. Runs both E2E tests (verify + repair loop)
5. Publishes to npm
6. Tags and pushes to GitHub

### Option B: Manual steps

```bash
# 1. Build
cd core
npm install
npm run build

# 2. Test
TMPDIR=/tmp node --test dist/session.test.js dist/evidence.test.js dist/verify.test.js dist/server.test.js dist/integration.test.js dist/mcp-server.test.js
TMPDIR=/tmp sh test-e2e.sh
TMPDIR=/tmp sh test-e2e-repair.sh

# 3. Publish
npm publish --access public

# 4. Tag
cd ..
git tag -a v2.0.0 -m "Release 2.0.0"
git push origin main --tags
```

## Version bumping

Before publishing a new version:

```bash
cd core
npm version patch   # 2.0.0 → 2.0.1
# or
npm version minor   # 2.0.0 → 2.1.0
```

This updates `package.json` and creates a commit. Then run `sh publish.sh`.

## Verify the publish

After publishing, test from a clean environment:

```bash
# In any project directory
npx browser-debug-agent doctor
npx browser-debug-agent setup kiro
```

## Unpublish (emergency)

```bash
npm unpublish browser-debug-agent@2.0.0
```

Only works within 72 hours of publish. Use sparingly.
