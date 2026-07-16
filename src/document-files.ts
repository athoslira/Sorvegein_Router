const TEXT_EXTENSIONS = new Set(['md', 'txt', 'text', 'csv', 'html', 'htm']);
const DOCLING_EXTENSIONS = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'odt', 'ods', 'odp', 'epub']);

function extensionOf(fileName: string): string {
	const index = fileName.lastIndexOf('.');
	return index === -1 ? '' : fileName.slice(index + 1).toLowerCase();
}

export function isTextDocument(fileName: string): boolean {
	return TEXT_EXTENSIONS.has(extensionOf(fileName));
}

export function needsDoclingConversion(fileName: string): boolean {
	return DOCLING_EXTENSIONS.has(extensionOf(fileName));
}

export function isSupportedDocument(fileName: string): boolean {
	return isTextDocument(fileName) || needsDoclingConversion(fileName);
}
