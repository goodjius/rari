import type { Linter } from 'eslint'
import * as tsParser from '@typescript-eslint/parser'
import gitignore from 'eslint-config-flat-gitignore'
import oxlint from 'eslint-plugin-oxlint'
import solid from 'eslint-plugin-solid/configs/typescript'
import { ignorePatterns } from './ignores'
import { lint as oxlintConfig } from './oxlint'
import { pnpmConfigs } from './pnpm'
import { packageJsonSortConfigs } from './sort'

const oxlintBridge = oxlint
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  .buildFromOxlintConfig(oxlintConfig as Parameters<typeof oxlint.buildFromOxlintConfig>[0])
  .map(config => {
    if (!config.rules) return config

    const rules = Object.assign({}, config.rules)
    for (const [name, value] of Object.entries(config.rules)) {
      if (name.startsWith('@typescript-eslint/'))
        rules[`ts/${name.slice('@typescript-eslint/'.length)}`] = value
      if (name.startsWith('n/')) rules[`node/${name.slice(2)}`] = value
    }

    return Object.assign({}, config, { rules })
  })

const configs: Linter.Config[] = [
  gitignore(),
  {
    ignores: [...ignorePatterns],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
  ...oxlintBridge,
  {
    // eslint-plugin-solid's rule types don't line up with ESLint's Linter.Config.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    ...(solid as unknown as Linter.Config),
    files: ['**/*.{ts,tsx}'],
  },
  ...pnpmConfigs,
  ...packageJsonSortConfigs,
]

export default configs
