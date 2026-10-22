export function isImdbHostname(value: string): boolean {
	const host = value.toLowerCase().replace(/\.+$/, '');
	return host === 'imdb.com' || host === 'www.imdb.com' || host === 'm.imdb.com';
}
