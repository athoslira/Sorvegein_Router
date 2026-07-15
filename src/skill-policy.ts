export function isSafeRelativePath(value: string): boolean {
	if (!value || value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) return false;
	return value.split(/[\\/]/).every((part) => part.length > 0 && part !== '.' && part !== '..');
}
export function isAllowedGitHubRepository(repository: string, allowed: string[]): boolean {
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return false;
	return allowed.some((item) => item.trim().toLowerCase() === repository.toLowerCase());
}
