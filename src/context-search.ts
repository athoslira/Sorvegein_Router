export interface SearchableContextEntry {
	id: string;
	path: string;
	title: string;
	terms: string[];
}

export function contextTerms(value: string, maximum = 80): string[] {
	const counts = new Map<string, number>();
	for (const token of tokenize(value)) counts.set(token, (counts.get(token) ?? 0) + 1);
	return [...counts.entries()]
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.slice(0, maximum)
		.map(([token]) => token);
}

export function rankContextEntries<T extends SearchableContextEntry>(entries: T[], query: string): T[] {
	const terms = new Set(tokenize(query));
	return entries
		.map((entry) => ({ entry, score: score(entry, terms) }))
		.filter(({ score }) => score > 0)
		.sort((left, right) => right.score - left.score || left.entry.path.localeCompare(right.entry.path))
		.map(({ entry }) => entry);
}

export function extractContextExcerpt(content: string, query: string, maximum = 12_000): string {
	if (content.length <= maximum) return content;
	const normalized = normalize(content);
	const positions = tokenize(query)
		.map((term) => normalized.indexOf(term))
		.filter((position) => position >= 0);
	const start = positions.length ? Math.max(0, Math.min(...positions) - Math.floor(maximum / 4)) : 0;
	const end = Math.min(content.length, start + maximum);
	return `${start ? '[…]\n' : ''}${content.slice(start, end)}${end < content.length ? '\n[…]' : ''}`;
}

function score(entry: SearchableContextEntry, queryTerms: Set<string>): number {
	if (queryTerms.size === 0) return 0;
	const titleTerms = new Set(tokenize(`${entry.title} ${entry.path}`));
	const indexedTerms = new Set(entry.terms);
	let total = 0;
	for (const term of queryTerms) {
		if (titleTerms.has(term)) total += 4;
		if (indexedTerms.has(term)) total += 1;
	}
	return total;
}

function tokenize(value: string): string[] {
	return normalize(value).match(/[a-z0-9]{3,}/g) ?? [];
}

function normalize(value: string): string {
	return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
