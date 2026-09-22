// Check-only on purpose: the hook blocks the commit instead of silently rewriting
// staged files. Fix with `pnpm format` / `pnpm lint:fix`, then re-stage.
export default {
  '*.{ts,tsx,js,mjs,cjs}': ['prettier --check', 'eslint --max-warnings=0'],
  '*.{json,md,yml,yaml,css,html}': 'prettier --check',
};
