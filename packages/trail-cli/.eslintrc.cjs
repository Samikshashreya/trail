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
    'no-multiple-empty-lines': 'off',
    'comma-dangle': 'off',
    'semi': ['error', 'always'],
    'no-empty': 'warn',
    'no-unreachable': 'warn',
    'no-undef': 'warn',
  },
};
