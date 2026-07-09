/** `0x85ec2459…f30d` — protocol ids and addresses are unreadable in full. */
export function formatId(id: string, head = 10, tail = 4): string {
	if (id.length <= head + tail + 1) {
		return id;
	}
	return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

const RELATIVE_UNITS: Array<[limitSeconds: number, divisor: number, suffix: string]> = [
	[60, 1, 's'],
	[3600, 60, 'm'],
	[86_400, 3600, 'h'],
	[2_592_000, 86_400, 'd'],
	[31_536_000, 2_592_000, 'mo'],
	[Number.POSITIVE_INFINITY, 31_536_000, 'y'],
];

/** Compact relative time: `12s`, `5m`, `2h`, `3d`, `1mo`, `2y`. */
export function formatRelativeTime(input: string | Date, now: Date = new Date()): string {
	const then = input instanceof Date ? input : new Date(input);
	const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
	for (const [limit, divisor, suffix] of RELATIVE_UNITS) {
		if (seconds < limit) {
			return `${Math.floor(seconds / divisor)}${suffix}`;
		}
	}
	return '—';
}

export function formatNumber(value: number): string {
	return new Intl.NumberFormat('en-US').format(value);
}

/** Single-line preview of arbitrary atom data for table cells. */
export function previewData(data: string | null, maxLength = 96): string {
	if (!data) {
		return '';
	}
	const flattened = data.replace(/\s+/g, ' ').trim();
	return flattened.length > maxLength ? `${flattened.slice(0, maxLength)}…` : flattened;
}
