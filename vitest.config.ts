import { configDefaults, defineConfig } from 'vitest/config'

// ken-task and ken-lint test against the TypeScript kernel, retired for the shell script `ken`,
// and read .ken.yaml and `ken config --json`, which it does not have. Their tests are left out
// until they are ported to .ken and the script.
export default defineConfig({
	test: { exclude: [...configDefaults.exclude, 'packages/ken-task/**', 'packages/ken-lint/**'] }
})
