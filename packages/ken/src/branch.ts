/**
 * Whether git takes `branch` as a branch name: the rules of `git check-ref-format --branch`,
 * and not `@`, which `git branch` refuses too.
 */
function isBranchName(branch: string): boolean {
	return (
		branch !== 'HEAD' &&
		branch !== '@' &&
		!branch.startsWith('-') &&
		!branch.endsWith('.') &&
		!branch.includes('..') &&
		!branch.includes('@{') &&
		// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
		!/[\x00-\x20\x7f~^:?*[\\]/.test(branch) &&
		branch.split('/').every((c) => c !== '' && !c.startsWith('.') && !c.endsWith('.lock'))
	)
}

/** The folder of a branch's worktree beside the clone, `.repos/<key>.<folder>`: `/` as `-`. */
export function branchFolder(branch: string): string {
	if (!isBranchName(branch)) {
		throw new Error(
			`${JSON.stringify(branch)} is not a branch name git accepts (git check-ref-format --branch), ` +
				'so no worktree can hold it. A branch name has no empty part between slashes, no part that ' +
				'starts with "." or ends in ".lock", no "..", "@{", space, control character or any of ~^:?*[\\, ' +
				'does not start with "-" or end with ".", and is not HEAD or @. Pick one such as feat/login.'
		)
	}
	return branch.replaceAll('/', '-')
}
