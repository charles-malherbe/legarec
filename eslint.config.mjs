import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'maquette/**', 'kits/**', '.comparaisons/**', '.claude/worktrees/**', '**/mockServiceWorker.js', 'apps/api/templates/**', 'apps/api/src/generated/**', '**/*.generated.ts'] },
  // Another checkout of the repository may live under .claude/worktrees: each one is its own root.
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }], '@typescript-eslint/consistent-type-imports': 'error' },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly', Buffer: 'readonly', document: 'readonly', Image: 'readonly', setTimeout: 'readonly' } },
  },
  {
    // One door to PostgreSQL: outside of the platform, only Database.run() and the transaction it opened.
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/platform/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/generated/prisma/**', '@prisma/*', 'pg'], message: 'Use Database: one transaction, with the rights of its actor.' },
            { group: ['bullmq', 'ioredis'], message: 'Use Outbox: the task leaves with the transaction.' },
          ],
        },
      ],
      'no-restricted-properties': ['error', { property: '$queryRawUnsafe' }, { property: '$executeRawUnsafe' }],
      'no-restricted-syntax': [
        'error',
        { selector: 'ImportExpression[source.value=/^(@prisma\\u002f|pg$|bullmq$|ioredis$)|generated\\u002fprisma/]', message: 'Use Database or Outbox.' },
        { selector: 'TemplateElement[value.raw=/set_config|\\b(re)?set\\s+(local\\s+|session\\s+)?(role|session)\\b/i]', message: 'Only Database.run() decides who is acting.' },
      ],
    },
  },
);
