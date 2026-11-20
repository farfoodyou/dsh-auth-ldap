/**
 * Conventional Commits enforcement for this repository.
 * Scope names follow the module layout under `src/`.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0, 'always'],
    'scope-enum': [
      1,
      'always',
      ['gate', 'session', 'backends', 'local', 'ldap', 'config', 'docs', 'ci', 'deps', 'release'],
    ],
  },
}
