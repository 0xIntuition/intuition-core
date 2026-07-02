import {
	type KgActionDb,
	listNodeProcessingDeadLetters,
	type NodeProcessingStage,
	type NodeProcessingStatus,
	requeueNodeProcessingStage,
	resetNodeProcessingStage,
} from '@0xintuition/database-kg/actions';

type KgCommandName =
	| 'kg-requeue-parse'
	| 'kg-requeue-classification'
	| 'kg-requeue-enrichment'
	| 'kg-dead-letter-parse'
	| 'kg-dead-letter-classification'
	| 'kg-dead-letter-enrichment'
	| 'kg-backfill-parse'
	| 'kg-backfill-classification'
	| 'kg-backfill-enrichment';

const KG_COMMANDS: readonly KgCommandName[] = [
	'kg-requeue-parse',
	'kg-requeue-classification',
	'kg-requeue-enrichment',
	'kg-dead-letter-parse',
	'kg-dead-letter-classification',
	'kg-dead-letter-enrichment',
	'kg-backfill-parse',
	'kg-backfill-classification',
	'kg-backfill-enrichment',
];

/**
 * Default eligible statuses for backfill. Restricting to terminal-but-incomplete
 * states (`failed` and `skipped`) keeps the canonical recovery path from
 * clobbering already-`completed` work, while still resetting `<stage>_attempts`
 * inside `resetNodeProcessingStage` so rows that previously hit
 * `WORKERS_MAX_ATTEMPTS` actually become claimable again.
 *
 * Operators that genuinely want to re-run completed work (e.g. after upgrading
 * a parser version) can pass `--statuses=completed,failed,skipped` explicitly.
 */
const DEFAULT_BACKFILL_STATUSES: readonly NodeProcessingStatus[] = ['failed', 'skipped'];
const VALID_BACKFILL_STATUSES: readonly NodeProcessingStatus[] = [
	'pending',
	'completed',
	'failed',
	'skipped',
];

type BackfillOptions = {
	statuses: readonly NodeProcessingStatus[];
	limit?: number;
	nodeIds?: string[];
	confirmed: boolean;
};

type DeadLetterOptions = {
	limit: number;
};

const MAX_DEAD_LETTER_LIMIT = 1_000;

export async function runKgCommand(db: KgActionDb, args: string[]): Promise<void> {
	const [command, ...rest] = args;

	switch (command) {
		case 'kg-requeue-parse':
			await requeueTarget(db, 'parse', rest, command);
			return;
		case 'kg-requeue-classification':
			await requeueTarget(db, 'classification', rest, command);
			return;
		case 'kg-requeue-enrichment':
			await requeueTarget(db, 'enrichment', rest, command);
			return;
		case 'kg-dead-letter-parse':
			await listDeadLetters(db, 'parse', rest, command);
			return;
		case 'kg-dead-letter-classification':
			await listDeadLetters(db, 'classification', rest, command);
			return;
		case 'kg-dead-letter-enrichment':
			await listDeadLetters(db, 'enrichment', rest, command);
			return;
		case 'kg-backfill-parse':
			await runBackfill(db, 'parse', rest, command);
			return;
		case 'kg-backfill-classification':
			await runBackfill(db, 'classification', rest, command);
			return;
		case 'kg-backfill-enrichment':
			await runBackfill(db, 'enrichment', rest, command);
			return;
		default:
			throw new Error(
				`Unknown KG command: ${command ?? '<none>'}. Supported commands: ${KG_COMMANDS.join(', ')}.`
			);
	}
}

async function listDeadLetters(
	db: KgActionDb,
	stage: NodeProcessingStage,
	rest: string[],
	command: string
): Promise<void> {
	const options = parseDeadLetterOptions(rest, command);
	const rows = await listNodeProcessingDeadLetters(db, {
		stage,
		limit: options.limit,
	});

	console.log(
		JSON.stringify({
			command,
			stage,
			count: rows.length,
			limit: options.limit,
			deadLetters: rows.map((row) => ({
				id: row.id,
				status: row.status,
				attempts: row.attempts,
				error: row.error,
				updatedAt: row.updatedAt,
			})),
		})
	);
}

async function requeueTarget(
	db: KgActionDb,
	stage: NodeProcessingStage,
	rest: string[],
	command: string
) {
	const positional = rest.filter((arg) => !arg.startsWith('--'));
	const target = positional[0];
	if (!target) {
		throw new Error(`Expected node id for ${command}.`);
	}

	const cascade = parseBoolFlag(rest, '--cascade-downstream', true);
	const force = parseBoolFlag(rest, '--force', false);

	await requeueNodeProcessingStage(db, {
		stage,
		nodeId: target,
		reason: `manual_${command.replaceAll('-', '_')}`,
		cascadeDownstream: cascade,
		force,
	});
}

async function runBackfill(
	db: KgActionDb,
	stage: NodeProcessingStage,
	rest: string[],
	command: string
): Promise<void> {
	const options = parseBackfillOptions(rest, command);
	if (!options.confirmed) {
		const summary = `${command} would reset rows with status in [${options.statuses.join(', ')}]`;
		const filterDescription = options.nodeIds
			? `${options.nodeIds.length} node id(s)`
			: options.limit !== undefined
				? `up to ${options.limit} rows`
				: 'every matching row in the table';
		throw new Error(
			`${summary} for ${filterDescription}. Re-run with --yes to confirm. ` +
				`Pass --statuses=failed,skipped (default), --limit=<n>, or --node-id=<id> to scope.`
		);
	}

	const { updated, ids } = await resetNodeProcessingStage(db, {
		stage,
		eligibleStatuses: options.statuses,
		limit: options.limit,
		nodeIds: options.nodeIds,
		reason: `manual_${command.replaceAll('-', '_')}`,
	});

	console.log(
		`[${command}] reset ${updated} ${stage} row(s) (statuses: ${options.statuses.join(',')})${
			ids.length > 0 && ids.length <= 25 ? `: ${ids.join(', ')}` : ''
		}`
	);
}

function parseBackfillOptions(rest: string[], command: string): BackfillOptions {
	let statuses: readonly NodeProcessingStatus[] = DEFAULT_BACKFILL_STATUSES;
	let limit: number | undefined;
	const nodeIds: string[] = [];
	let confirmed = false;

	for (const arg of rest) {
		if (arg === '--yes' || arg === '-y') {
			confirmed = true;
			continue;
		}
		if (arg.startsWith('--statuses=')) {
			const raw = arg.slice('--statuses='.length);
			const parsed = raw
				.split(',')
				.map((s) => s.trim())
				.filter((s): s is NodeProcessingStatus => {
					if (!s) {
						return false;
					}
					if (!VALID_BACKFILL_STATUSES.includes(s as NodeProcessingStatus)) {
						throw new Error(
							`${command}: invalid --statuses value "${s}"; must be one of ${VALID_BACKFILL_STATUSES.join(', ')}.`
						);
					}
					return true;
				});
			if (parsed.length === 0) {
				throw new Error(`${command}: --statuses requires at least one value.`);
			}
			statuses = parsed;
			continue;
		}
		if (arg.startsWith('--limit=')) {
			const raw = arg.slice('--limit='.length);
			const value = Number.parseInt(raw, 10);
			if (!Number.isInteger(value) || value < 1) {
				throw new Error(`${command}: --limit must be a positive integer (got "${raw}").`);
			}
			limit = value;
			continue;
		}
		if (arg.startsWith('--node-id=')) {
			nodeIds.push(arg.slice('--node-id='.length));
			continue;
		}
		if (arg.startsWith('--')) {
			throw new Error(`${command}: unknown flag "${arg}".`);
		}
	}

	return {
		statuses,
		limit,
		nodeIds: nodeIds.length > 0 ? nodeIds : undefined,
		confirmed,
	};
}

function parseDeadLetterOptions(rest: string[], command: string): DeadLetterOptions {
	let limit = 25;

	for (const arg of rest) {
		if (arg.startsWith('--limit=')) {
			limit = parsePositiveIntegerFlag(
				command,
				'--limit',
				arg.slice('--limit='.length),
				MAX_DEAD_LETTER_LIMIT
			);
			continue;
		}
		if (arg.startsWith('--')) {
			throw new Error(`${command}: unknown flag "${arg}".`);
		}
		throw new Error(`${command}: unexpected positional argument "${arg}".`);
	}

	return { limit };
}

function parsePositiveIntegerFlag(
	command: string,
	flag: string,
	raw: string,
	max?: number
): number {
	const value = Number.parseInt(raw, 10);
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${command}: ${flag} must be a positive integer (got "${raw}").`);
	}
	if (max !== undefined && value > max) {
		throw new Error(`${command}: ${flag} must be <= ${max} (got "${raw}").`);
	}
	return value;
}

function parseBoolFlag(rest: string[], flag: string, defaultValue: boolean): boolean {
	for (const arg of rest) {
		if (arg === flag || arg === `${flag}=true`) {
			return true;
		}
		if (arg === `--no-${flag.slice(2)}` || arg === `${flag}=false`) {
			return false;
		}
	}
	return defaultValue;
}
