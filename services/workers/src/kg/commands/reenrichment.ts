import type { EnrichmentArtifact } from '@0xintuition/atom-enrichment';
import { classificationSlugLikeSchema } from '@0xintuition/atom-enrichment/types';
import {
	type KgActionDb,
	listReenrichmentCandidates,
	resetNodeProcessingStage,
} from '@0xintuition/database-kg/actions';
import { z } from 'zod/v4';
import type { IdentityRungProjection } from '../../core/identity-contract';

// Core's public handoff rung tokens and slug-validated plugin IDs are strings.
// This operator routing table is not an IID resolver or ladder policy.
export const REENRICHMENT_RUNG_PLUGINS = {
	'spotify:album': 'spotify',
	'spotify:track': 'spotify',
	'spotify:artist': 'spotify',
	'spotify:show': 'spotify',
	'spotify:episode': 'spotify',
	'tmdb:movie': 'tmdb',
	'tmdb:tv': 'tmdb',
	wd: 'wikidata',
	'wd:film': 'wikidata',
	'wd:television-series': 'wikidata',
	olid: 'openlibrary',
	isbn: 'openlibrary',
	podcastguid: 'podcast-index',
	rssitem: 'podcast-index',
} as const satisfies Partial<
	Record<IdentityRungProjection['rungs'][number]['rung'], EnrichmentArtifact['meta']['pluginId']>
>;

const COMMAND = 'kg-reenrich-missing-provider';

type ReenrichmentOptions = {
	plugin: EnrichmentArtifact['meta']['pluginId'];
	rungs: string[];
	createdSince?: Date;
	limit: number;
	batchSize: number;
	cursor?: string;
	confirmed: boolean;
};

export function parseReenrichmentOptions(rest: readonly string[]): ReenrichmentOptions {
	const values = new Map<string, string>();
	let confirmed = false;
	for (let index = 0; index < rest.length; index++) {
		const arg = rest[index]!;
		if (arg === '--confirm') {
			confirmed = true;
			continue;
		}
		const separator = arg.indexOf('=');
		const flag = separator < 0 ? arg : arg.slice(0, separator);
		if (
			!['--plugin', '--rungs', '--created-since', '--limit', '--batch-size', '--cursor'].includes(
				flag
			)
		) {
			throw new Error(`${COMMAND}: unknown argument "${arg}".`);
		}
		const raw = separator < 0 ? rest[++index] : arg.slice(separator + 1);
		if (raw === undefined || raw.startsWith('--') || !raw.trim())
			throw new Error(`${COMMAND}: ${flag} requires a value.`);
		values.set(flag, raw.trim());
	}
	const plugin = classificationSlugLikeSchema.parse(values.get('--plugin'));
	const defaults = Object.entries(REENRICHMENT_RUNG_PLUGINS)
		.filter(([, p]) => p === plugin)
		.map(([r]) => r);
	if (!defaults.length) throw new Error(`${COMMAND}: plugin has no mapped rungs.`);
	const rungs = values.has('--rungs')
		? [
				...new Set(
					values
						.get('--rungs')!
						.split(',')
						.map((r) => r.trim())
				),
			]
		: defaults;
	if (rungs.some((rung) => !defaults.includes(rung)))
		throw new Error(`${COMMAND}: unmapped rung for plugin.`);
	const integer = (flag: string, fallback: number, max: number) => {
		const raw = values.get(flag);
		if (raw === undefined) return fallback;
		const value = Number(raw);
		if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max)
			throw new Error(`${COMMAND}: ${flag} must be an integer from 1 to ${max}.`);
		return value;
	};
	const date = values.get('--created-since');
	if (date !== undefined && !z.iso.datetime({ offset: true }).safeParse(date).success)
		throw new Error(`${COMMAND}: --created-since must be a valid ISO timestamp with timezone.`);
	return {
		plugin,
		rungs,
		...(date !== undefined ? { createdSince: new Date(date) } : {}),
		limit: integer('--limit', 10000, Number.MAX_SAFE_INTEGER),
		batchSize: integer('--batch-size', 1000, 5000),
		...(values.has('--cursor') ? { cursor: values.get('--cursor')! } : {}),
		confirmed,
	};
}

export async function runReenrichment(db: KgActionDb, rest: readonly string[]): Promise<void> {
	const options = parseReenrichmentOptions(rest);
	let cursor = options.cursor;
	let lastResetId: string | undefined;
	let totalCandidates = 0;
	let totalReset = 0;
	try {
		while (totalCandidates < options.limit) {
			const page = await listReenrichmentCandidates(db, {
				missingPlugin: options.plugin,
				rungs: options.rungs,
				createdSince: options.createdSince,
				limit: Math.min(options.batchSize, options.limit - totalCandidates),
				cursor,
			});
			let reset = 0;
			if (options.confirmed && page.ids.length) {
				const result = await resetNodeProcessingStage(db, {
					stage: 'enrichment',
					eligibleStatuses: ['completed'],
					nodeIds: page.ids,
					reason: `${COMMAND}:${options.plugin}`,
				});
				reset = result.updated;
				lastResetId = result.ids.sort().at(-1) ?? lastResetId;
			}
			totalCandidates += page.ids.length;
			totalReset += reset;
			cursor = page.ids.at(-1) ?? cursor;
			console.log(
				JSON.stringify({
					command: COMMAND,
					mode: options.confirmed ? 'apply' : 'dry-run',
					plugin: options.plugin,
					count: page.ids.length,
					sampleIds: page.ids.slice(0, 10),
					reset,
					totalCandidates,
					totalReset,
					cursor: cursor ?? null,
					lastResetId: lastResetId ?? null,
					limitReached: totalCandidates === options.limit,
				})
			);
			if (!page.nextCursor) break;
		}
	} catch (error) {
		console.error(
			JSON.stringify({
				command: COMMAND,
				status: 'error',
				cursor: cursor ?? null,
				lastResetId: lastResetId ?? null,
				totalCandidates,
				totalReset,
			})
		);
		throw error;
	}
}
