## What

<!-- One paragraph. Link the module spec / issue. -->

## How

<!-- Key decisions. Platform APIs touched. Contract changes (additive?). -->

## Evidence

- [ ] Screen recording / Storybook link for visual changes
- [ ] Perf numbers (idle CPU %, RSS MB, fps during morph) if shell/motion/module-strip touched
- [ ] Tests added/updated (`vitest`, `cargo test`, Playwright)

## Checklist

- [ ] PR title is a Conventional Commit (`type(scope): lower-case subject`) — it becomes the
      squash-commit and changelog entry ([rules](../docs/11-ci-cd.md#commits-and-pr-titles))
- [ ] Follows `docs/05-design-system.md` & `docs/06-motion-spec.md` (tokens/presets only)
- [ ] No OS access from the UI; platform code in `src-tauri/src/platform`
- [ ] Work stops when not visible (timers, RAF, capture)
- [ ] Accessible names, keyboard, reduced motion
- [ ] Copy in sentence case; i18n keys added
- [ ] Docs/spec updated (status, deviations)
- [ ] All required checks green without skipping, retrying-until-green or lowering a threshold
      (`pnpm -w ci`, `ci:rust`, `ci:deps`, `ci:app`, `docs:check` locally)
- [ ] New dependency? One-line justification above and licence in the allowlist
