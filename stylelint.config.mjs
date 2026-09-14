/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: [
    '**/node_modules/**',
    '**/dist/**',
    '**/storybook-static/**',
    '**/coverage/**',
    // Cargo build output (tauri-codegen copies the web bundle's CSS under target/).
    '**/target/**',
    '**/src-tauri/gen/**',
  ],
  rules: {
    // Tailwind v4 directives.
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: [
          'theme',
          'source',
          'utility',
          'variant',
          'custom-variant',
          'apply',
          'reference',
          'config',
          'plugin',
          'tailwind',
        ],
      },
    ],
    'at-rule-no-deprecated': [true, { ignoreAtRules: ['apply'] }],
    'import-notation': 'string',
    // Token values are written exactly as docs/05-design-system.md tables them.
    'alpha-value-notation': 'number',
    'color-hex-length': null,
    'custom-property-empty-line-before': null,
    'declaration-empty-line-before': null,
    'comment-empty-line-before': null,
    'custom-property-pattern': [
      // kebab-case, with Tailwind v4's `--text-body--line-height` suffix and `--color-*` namespace
      // reset forms allowed inside `@theme` blocks.
      '^[a-z][a-z0-9]*(-{1,2}[a-z0-9]+)*(-\\*)?$',
      { message: 'Custom properties are kebab-case (e.g. --text-caption2)' },
    ],
    'selector-class-pattern': null,
    'value-keyword-case': ['lower', { camelCaseSvgKeywords: false }],
  },
};
