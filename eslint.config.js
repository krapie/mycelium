import js from '@eslint/js';

// Correctness-only — no stylistic rules (no Prettier here either, see
// CONTRIBUTING.md): the codebase already has a consistent hand-written
// style, and a formatter pass now would just produce one huge, noisy diff.
export default [
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        queueMicrotask: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        structuredClone: 'readonly',
        fetch: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: {
      // A leading underscore is the established convention (this codebase
      // and most Node projects) for "intentionally unused" — e.g. callback
      // params required by a library's signature but not needed here.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // The extension is CommonJS (VS Code loads `main` with require, and we
    // ship no bundler), unlike the ESM core above.
    files: ['vscode/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', __dirname: 'readonly' },
    },
  },
  {
    ignores: ['node_modules/**', 'desktop/**', 'vscode/node_modules/**'],
  },
];
