/** Strip credentials before diagnostics cross a persistence or response boundary. */
export function redactProviderDiagnostic(message: string): string {
	return (
		message
			// Drop the entire query and fragment, including unknown credential parameter names.
			.replace(/(?:[a-z][a-z\d+.-]*:)?\/\/[^\s<>"'`]+/gi, (url) =>
				url.split(/[?#]/, 1)[0]!.replace(/(\/\/)[^/]*@/, '$1')
			)
			// Libraries sometimes omit the scheme when reporting an endpoint.
			.replace(
				/\b(?:[a-z\d-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"'`?#]*)?[?#][^\s<>"'`]+/gi,
				(url) => url.split(/[?#]/, 1)[0]!
			)
			// Also handle standalone parameters and headers, including JSON-quoted fields.
			.replace(
				/\b(authorization|api[-_]?key|access[-_]?token|token|key)["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|(?:bearer|basic)\s+[^\s,;}]+|[^\s&,;}]+)/gi,
				'$1=[REDACTED]'
			)
	);
}
