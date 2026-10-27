import js from '@eslint/js';
import globals from 'globals';

export default [
  {ignores:['dist/**','node_modules/**','reports/**']},
  js.configs.recommended,
  {
    files:['**/*.js'],
    languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{...globals.browser,...globals.node}},
    rules:{
      'no-unused-vars':['error',{argsIgnorePattern:'^_',caughtErrorsIgnorePattern:'^_'}],
      'no-var':'error',
      'prefer-const':'error',
      'eqeqeq':['error','always',{null:'ignore'}],
      'no-duplicate-imports':'error',
    },
  },
];
