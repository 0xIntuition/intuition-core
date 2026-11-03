export type StatusTarget = { name: string; url: string };

/** Keep the health sweep aligned with the API and the active local profile. */
export function statusTargets(options: {
	apiUrl: string;
	indexingEnabled?: boolean;
	override?: string;
}): StatusTarget[] {
	if (options.override?.trim()) {
		return options.override
			.split(',')
			.map((entry) => {
				const [name, ...rest] = entry.split('=');
				return { name: (name ?? '').trim(), url: rest.join('=').trim() };
			})
			.filter((target) => target.name && target.url);
	}

	const targets = [
		{ name: 'api', url: new URL('/health', options.apiUrl).toString() },
		{ name: 'atom-services', url: 'http://localhost:4010/ready' },
		{ name: 'worker-parse', url: 'http://localhost:4110/readyz' },
		{ name: 'worker-enrichment', url: 'http://localhost:4111/readyz' },
		{ name: 'worker-classification', url: 'http://localhost:4112/readyz' },
	];
	if (options.indexingEnabled) {
		targets.push(
			{ name: 'indexer', url: 'http://localhost:9091/health' },
			{ name: 'projections', url: 'http://localhost:9092/health/ready' }
		);
	}
	return targets;
}
