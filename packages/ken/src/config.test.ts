import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readKenYaml } from './config.ts'

const rootWith = (text: string) => {
	const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ken-config-')))
	writeFileSync(join(root, '.ken.yaml'), text)
	return root
}

describe('readKenYaml', () => {
	it.each([
		['layers: foo', 'layers must be a list of { name, key }, got "foo"'],
		['clone: { blobless: maybe }', 'clone.blobless must be true or false, got "maybe"'],
		[
			'layers: [{ name: atlas, key: "https://github.com/acme/atlas.git" }]',
			'layers[0].key must be a lowercase repo key'
		],
		['orgs: { me: xiaoxinghu }', 'orgs.me must be a lowercase <host>/<owner>'],
		// ken config --json prints the root under "root", so a section of that name would be lost
		['root: ~/ken', 'root must be absent: the root is per machine'],
		['a: [', 'is not valid YAML']
	])('refuses %j, naming the file and the key', (text, message) => {
		const root = rootWith(text)
		expect(() => readKenYaml(root)).toThrow(message)
		expect(() => readKenYaml(root)).toThrow(join(root, '.ken.yaml'))
	})

	it.each([
		[
			'layers: [{ name: atlas, key: "https://user:s3cret@github.com/acme/atlas.git" }]',
			'layers[0].key must be'
		],
		[
			'layers: [{ name: atlas, key: "https://user:s3cret@github.com/acme/atlas.git }]',
			'is not valid YAML'
		]
	])('never shows the userinfo of a URL in %j', (text, refusal) => {
		const root = rootWith(text)
		const message = (() => {
			try {
				readKenYaml(root)
			} catch (e) {
				return (e as Error).message
			}
		})()
		expect(message).toContain(refusal)
		expect(message).not.toContain('s3cret')
	})

	it('reads an empty file, and an empty key, as the defaults', () => {
		expect(readKenYaml(rootWith(''))).toEqual(readKenYaml(rootWith('orgs:\nclone:\nlayers:\n')))
		expect(readKenYaml(rootWith(''))).toEqual({
			orgs: {},
			clone: { blobless: true },
			bloblessFrom: 'default',
			layers: [],
			sections: {}
		})
	})
})
