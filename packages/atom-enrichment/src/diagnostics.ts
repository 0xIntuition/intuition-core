/** Strip credentials before diagnostics cross a persistence or response boundary. */
export function redactProviderDiagnostic(message: string): string {
	return (
		message
			// Drop the entire query and fragment, including unknown credential parameter names.
			.replace(/(?:[a-z][a-z\d+.-]*:)?\/\/[^\s<>"'`]+/gi, (url) =>
				url.split(/[?#]/, 1)[0]!.replace(/(\/\/)[^/]*@/, '$1')
			)
			// Some libraries report headers/parameters outside the request URL.
			.replace(/\b(authorization)\s*[=:]\s*(?:bearer\s+|basic\s+)?[^\s,;"'}]+/gi, '$1=[REDACTED]')
			.replace(
				/\b(api[-_]?key|access[-_]?token|token|key)\s*[=:]\s*[^\s&,;"'}]+/gi,
				'$1=[REDACTED]'
			)
	);
}
