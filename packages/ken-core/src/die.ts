// How ken stops: one function, so every refusal reads the same and ends the same.

/** A refusal: its message is what is the case, why it matters and what to run (PRD 24). */
export class KenError extends Error {}

/** Stop the command with `parts`, joined by spaces; the entry prints it and exits 1. */
export function die(...parts: string[]): never {
	throw new KenError(parts.join(' '))
}

/** `s` as one shell word, so a command in a message can be pasted: as is when nothing in it is
 * special to a shell, else single-quoted. */
export const q = (s: string) =>
	/^[A-Za-z0-9_./@%+=:,-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`
