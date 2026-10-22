/**
 * Strip credentials before diagnostics cross a persistence or response boundary.
 *
 * Provider failures are reported as free text. Request URLs, authorization headers,
 * and credential parameters can appear in that text verbatim, percent-encoded, or
 * JSON-escaped. Every rule here errs toward dropping prose rather than keeping a
 * secret: a redacted diagnostic is still useful, a persisted credential is not.
 */

const QUOTE = `\\\\?["']`;
const CREDENTIAL_NAMES = [
	'proxy-authorization',
	'authorization',
	'x-api-key',
	'api[-_]?key',
	'private[-_]?key',
	'secret[-_]?key',
	'client[-_]?secret',
	'secret',
	'access[-_]?token',
	'refresh[-_]?token',
	'id[-_]?token',
	'auth[-_]?token',
	'token',
	'passw(?:or)?d',
	'session(?:[-_]?id)?',
	'sig(?:nature)?',
	'credentials?',
	'cookie',
	'key',
].join('|');

/** Query, fragment, or their percent-encoded separators. */
const SEPARATOR = /[?#]|%23|%3f/i;
const URL_WITH_AUTHORITY = /(?:[a-z][a-z\d+.-]*:)?\/\/[^\s<>"'`]+/gi;
const SCHEMELESS_URL =
	/\b(?:(?:[a-z\d-]+\.)+[a-z\d-]+|[a-z\d-]+:\d+|localhost|[a-z\d-]+(?=\/))(?::\d+)?(?:\/[^\s<>"'`?#]*)?(?:[?#]|%23|%3f)[^\s<>"'`]+/gi;
const SCHEMELESS_USERINFO =
	/\b[^\s/@<>"'`:]+:[^\s/@<>"'`]+@(?=(?:[a-z\d-]+\.)+[a-z\d-]+|localhost|\[)/gi;
const CREDENTIAL_ASSIGNMENT = new RegExp(
	`(?:${QUOTE})?\\b(${CREDENTIAL_NAMES})\\b(?:${QUOTE})?\\s*(?:=|:|%3d|%3a)\\s*(?:\\\\?"(?:[^"\\\\]|\\\\.)*\\\\?"|\\\\?'(?:[^'\\\\]|\\\\.)*\\\\?'|(?:bearer|basic)\\s+[^\\s,;}]+|[^\\s&,;}"']+)`,
	'gi'
);
const BARE_HTTP_AUTH = /\b(bearer|basic)\s+(?!\[REDACTED\])[a-z\d._~+/=-]{6,}/gi;

export function redactProviderDiagnostic(message: string): string {
	return message
		.replace(URL_WITH_AUTHORITY, (url) =>
			url.split(SEPARATOR, 1)[0]!.replace(/(\/\/)[^/@\s]*@/, '$1')
		)
		.replace(SCHEMELESS_URL, (url) => url.split(SEPARATOR, 1)[0]!)
		.replace(SCHEMELESS_USERINFO, '')
		.replace(CREDENTIAL_ASSIGNMENT, '$1=[REDACTED]')
		.replace(BARE_HTTP_AUTH, '$1 [REDACTED]');
}
