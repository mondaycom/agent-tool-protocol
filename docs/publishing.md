# Publishing Guide

## Production Releases (Automated)

Production releases happen automatically when you push to `master`:

1. Merge your PR to `master` with conventional commit messages:
   - `fix:` - Patch version bump (0.18.3 → 0.18.4)
   - `feat:` - Minor version bump (0.18.3 → 0.19.0)
   - `feat!:` or `BREAKING CHANGE:` - Major version bump (0.18.3 → 1.0.0)

2. The CI automatically:
   - Creates version commits and tags
   - Publishes to npm with `latest` tag

## Prerelease Publishing (From Your Branch)

Publish test versions from any branch without affecting production:

### Steps:

1. **Push your branch to GitHub**:

   ```bash
   git push origin your-branch-name
   ```

2. **Go to GitHub Actions** → **Publish Prerelease** → **Run workflow**

3. **Select your branch**: In the dropdown, choose "Use workflow from: your-branch-name"

4. **Configure inputs**:
   - **Prerelease identifier**: `rc` (creates versions like `0.18.4-rc.0`, `0.18.4-rc.1`)
   - **NPM dist-tag**: Leave empty (auto-uses `rc`) or specify custom
   - **Skip versioning**: Uncheck (to create new versions)
   - **Skip git push**: Uncheck (to push version commits)

5. **Click "Run workflow"**

### What happens:

- Builds all packages from your branch
- Creates prerelease version (e.g., `0.18.4-rc.0`)
- Commits and pushes version to your branch
- Publishes to npm with `rc` tag
- Generates install instructions

### Installing prereleases:

```bash
# Install by tag
npm install @mondaydotcomorg/atp-server@rc

# Or install specific version
npm install @mondaydotcomorg/atp-server@0.18.4-rc.0
```

### Common prerelease identifiers:

- `rc` - Release candidate
- `beta` - Beta version
- `alpha` - Alpha version
- `canary` - Canary/nightly builds
- Custom - Any string (e.g., `feature-xyz`)

### Version increments:

Each time you run the workflow with the same `preid`, the number increments:

- First run: `0.18.4-rc.0`
- Second run: `0.18.4-rc.1`
- Third run: `0.18.4-rc.2`

The base version (0.18.4) is determined by your conventional commits since the last release.

## Examples

### Publish RC from feature branch:

```bash
# 1. Push your branch
git push origin gadsh/plugin-compiler

# 2. Go to Actions → Publish Prerelease → Run workflow
#    - Branch: gadsh/plugin-compiler
#    - Prerelease identifier: rc
#    - Leave other options default

# 3. Users install with:
npm install @mondaydotcomorg/atp-compiler@rc
```

### Publish with custom tag:

```bash
# Use a custom identifier like "test" or "feature-xyz"
# This creates versions like: 0.18.4-test.0

# Users install with:
npm install @mondaydotcomorg/atp-server@test
```

## Notes

- Prereleases don't affect the `latest` npm tag
- You can publish from any branch
- Multiple prereleases can exist simultaneously with different tags
- Use `skip_version` if you manually versioned and just want to publish
- Use `skip_git_push` for testing without pushing commits
