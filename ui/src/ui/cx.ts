/** Concatena classi ignorando i falsy. Al posto di clsx: non vale una dipendenza. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
