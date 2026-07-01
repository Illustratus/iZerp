## What & why

<!-- What does this change and what problem does it solve? Link any issue. -->

Closes #

## Checklist

- [ ] Kept iZerp dependency-free and build-free (no runtime deps, no bundler).
- [ ] User-facing strings added to **both** `de` and `en` in the `STRINGS` table.
- [ ] Colours/fonts done via CSS variables on `#izerp-root`, not hard-coded.
- [ ] `npm run lint` and `npm test` pass; `npm run test:e2e` if behaviour changed.
- [ ] Ran `npm run build` and committed the regenerated `dist/` (if src changed).
- [ ] Tested by hand: editor, presentation, settings, and `destroy()` + re-init.
- [ ] Updated `CHANGELOG.md` (and the READMEs if behaviour/API changed).

## Notes for reviewers

<!-- Anything worth calling out: trade-offs, follow-ups, screenshots. -->
