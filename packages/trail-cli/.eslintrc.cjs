module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true,
  },
  extends: [
    'eslint:recommended',
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    'no-console': 'off',
    'no-unused-vars': 'warn',
    'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1 }],
    'comma-dangle': ['error', 'always-multiline'],
    'semi': ['error', 'always'],
  },
};
