import { define } from 'rstack';

const scriptFiles = ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'];
const typeScriptFiles = ['**/*.{ts,tsx,mts,cts}'];
const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  'output/**',
  '**/target/**',
  'build/**',
  '.tmp/**',
  '.idea/**',
  '.rstack/cache/**',
  '**/shared/third_party/**',
];

define.fmt({
  singleQuote: true,
  printWidth: 100,
  ignorePatterns: ignores,
});

define.lint(({ js, ts }) => [
  { ignores },
  { files: scriptFiles },
  js.configs.recommended,
  ...ts.configs.recommended.map((config) => ({ ...config, files: typeScriptFiles })),
  {
    files: typeScriptFiles,
    languageOptions: {
      parserOptions: {
        project: [
          './src/app/tsconfig.json',
          './src/main/desktop/tsconfig.json',
          './tsconfig.tools.json',
        ],
      },
    },
  },
  {
    files: scriptFiles,
    plugins: ['unicorn'],
    rules: {
      curly: ['error', 'all'],
      'unicorn/filename-case': [
        'error',
        {
          case: 'kebabCase',
          checkDirectories: true,
          multipleFileExtensions: true,
          ignore: ['^__tests__$'],
        },
      ],
    },
  },
  {
    files: ['**/__tests__/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    plugins: ['unicorn'],
    rules: {
      'unicorn/filename-case': [
        'error',
        {
          case: 'kebabCase',
          checkDirectories: false,
          multipleFileExtensions: true,
        },
      ],
    },
  },
]);
