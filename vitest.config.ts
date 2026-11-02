import { configDefaults, defineConfig } from 'vitest/config'

// ken-lint tests against the TypeScript kernel, retired for the shell script `ken`, and reads
// .ken.yaml and `ken config --json`, which it does not have. Its tests are left out until they
// are ported to .ken and the script.
export default defineConfig({
	test: { exclude: [...configDefaults.exclude, 'packages/ken-lint/**'] }
})
