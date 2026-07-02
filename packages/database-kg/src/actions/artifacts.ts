import { createHash } from 'node:crypto';

import { and, desc, eq, inArray } from 'drizzle-orm';

import { artifacts } from '../schema';
import { forbidden, notFound } from './errors';
import { kgAtomId, normalizeProtocolTermId, tryNormalizeProtocolTermId } from './ids';
import { ensureAccount, ensureNode } from './nodes';
import type { EnsureNodeInput, KgActionDb } from './types';
import { inKgTransaction } from './types';

export type CreateArtifactInput = {
	id?: string;
	nodeId: string;
	node?: EnsureNodeInput;
	artifactKind: string;
	artifactVersion: string;
	status?: string;
	sourceUri?: string | null;
	sourceHash?: string | null;
	data: unknown;
	extracted?: unknown;
	error?: unknown;
	createdByAccountId?: string | null;
};

export type AttachArtifactToNodeInput = {
	artifactId: string;
	nodeId: string;
	node?: EnsureNodeInput;
	actorAccountId?: string | null;
};

export type GetArtifactsForNodeInput = {
	nodeId: string;
	artifactKind?: string;
	status?: string;
};

export type GetArtifactsForNodesInput = {
	nodeIds: string[];
	artifactKind?: string;
	status?: string;
};

export function createArtifactId(input: {
	nodeId: string;
	artifactKind: string;
	artifactVersion: string;
	sourceUri?: string | null;
	sourceHash?: string | null;
	data?: unknown;
}): string {
	const sourceHash = input.sourceHash ?? hashArtifactPayload(input.data ?? {});
	const material = stableJsonStringify({
		nodeId: input.nodeId,
		artifactKind: input.artifactKind,
		artifactVersion: input.artifactVersion,
		sourceUri: input.sourceUri ?? null,
		sourceHash,
	});

	return `artifact:${sha256(material)}`;
}

export function hashArtifactPayload(data: unknown): string {
	return sha256(stableJsonStringify(data));
}

export async function createArtifact(db: KgActionDb, input: CreateArtifactInput): Promise<string> {
	return inKgTransaction(db, (tx) => createArtifactInTransaction(tx, input));
}

async function createArtifactInTransaction(
	db: KgActionDb,
	input: CreateArtifactInput
): Promise<string> {
	assertArtifactNodeInput(input);
	const nodeId = normalizeProtocolTermId(input.nodeId, 'nodeId');

	const sourceHash = input.sourceHash ?? hashArtifactPayload(input.data);
	const artifactId =
		input.id ??
		createArtifactId({
			nodeId,
			artifactKind: input.artifactKind,
			artifactVersion: input.artifactVersion,
			sourceUri: input.sourceUri,
			sourceHash,
		});
	const actorAccountId = input.createdByAccountId ?? null;

	if (input.node) {
		await ensureNode(db, input.node);
	}
	await assertArtifactCreateOrUpdateAllowed(db, {
		artifactId,
		accountId: actorAccountId,
	});
	if (actorAccountId) {
		await ensureAccount(db, actorAccountId);
	}

	await db
		.insert(artifacts)
		.values({
			id: artifactId,
			nodeId,
			artifactKind: input.artifactKind,
			artifactVersion: input.artifactVersion,
			status: input.status ?? 'active',
			sourceUri: input.sourceUri,
			sourceHash,
			data: input.data ?? {},
			extracted: input.extracted ?? {},
			error: input.error,
			...(actorAccountId ? { createdByAccountId: actorAccountId } : {}),
		})
		.onConflictDoUpdate({
			target: artifacts.id,
			set: {
				nodeId,
				artifactKind: input.artifactKind,
				artifactVersion: input.artifactVersion,
				status: input.status ?? 'active',
				sourceUri: input.sourceUri,
				sourceHash,
				data: input.data ?? {},
				extracted: input.extracted ?? {},
				error: input.error,
				...(actorAccountId ? { createdByAccountId: actorAccountId } : {}),
				updatedAt: new Date(),
			},
		});

	return artifactId;
}

export async function createArtifacts(
	db: KgActionDb,
	inputs: CreateArtifactInput[]
): Promise<string[]> {
	return inKgTransaction(db, async (tx) => {
		const artifactIds: string[] = [];

		for (const input of inputs) {
			artifactIds.push(await createArtifactInTransaction(tx, input));
		}

		return artifactIds;
	});
}

export async function attachArtifactToNode(
	db: KgActionDb,
	input: AttachArtifactToNodeInput
): Promise<string> {
	return inKgTransaction(db, (tx) => attachArtifactToNodeInTransaction(tx, input));
}

async function attachArtifactToNodeInTransaction(
	db: KgActionDb,
	input: AttachArtifactToNodeInput
): Promise<string> {
	assertAttachArtifactNodeInput(input);
	const nodeId = normalizeProtocolTermId(input.nodeId, 'nodeId');

	if (input.node) {
		await ensureNode(db, input.node);
	}
	if (input.actorAccountId) {
		await assertArtifactMutableBy(db, {
			artifactId: input.artifactId,
			accountId: input.actorAccountId,
		});
	}

	await db
		.update(artifacts)
		.set({
			nodeId,
			updatedAt: new Date(),
		})
		.where(eq(artifacts.id, input.artifactId));

	return input.artifactId;
}

export async function getArtifactById(db: KgActionDb, artifactId: string) {
	const rows = await db.select().from(artifacts).where(eq(artifacts.id, artifactId));

	return rows[0] ?? null;
}

export async function getArtifactsForNode(db: KgActionDb, input: GetArtifactsForNodeInput) {
	const filters = [eq(artifacts.nodeId, normalizeProtocolTermId(input.nodeId, 'nodeId'))];

	if (input.artifactKind) {
		filters.push(eq(artifacts.artifactKind, input.artifactKind));
	}
	if (input.status) {
		filters.push(eq(artifacts.status, input.status));
	}

	return db
		.select()
		.from(artifacts)
		.where(and(...filters))
		.orderBy(desc(artifacts.updatedAt));
}

export async function getArtifactsForNodes(db: KgActionDb, input: GetArtifactsForNodesInput) {
	if (input.nodeIds.length === 0) {
		return [];
	}

	// Skip non-protocol-term node ids (e.g. legacy/seed integer ids). Artifacts
	// only exist for protocol-term nodes, so filtering invalid ids out — rather
	// than throwing — keeps batch reads (e.g. kgAtom.allCursor includeArtifacts)
	// resilient to mixed node-id sets instead of failing the whole page.
	const nodeIds = input.nodeIds
		.map((nodeId) => tryNormalizeProtocolTermId(nodeId))
		.filter((nodeId): nodeId is `0x${string}` => nodeId !== null);
	if (nodeIds.length === 0) {
		return [];
	}

	const filters = [inArray(artifacts.nodeId, nodeIds)];

	if (input.artifactKind) {
		filters.push(eq(artifacts.artifactKind, input.artifactKind));
	}
	if (input.status) {
		filters.push(eq(artifacts.status, input.status));
	}

	return db
		.select()
		.from(artifacts)
		.where(and(...filters))
		.orderBy(desc(artifacts.updatedAt));
}

export async function getPrimaryArtifactForNode(db: KgActionDb, input: GetArtifactsForNodeInput) {
	const rows = await db
		.select()
		.from(artifacts)
		.where(
			and(
				eq(artifacts.nodeId, normalizeProtocolTermId(input.nodeId, 'nodeId')),
				...(input.artifactKind ? [eq(artifacts.artifactKind, input.artifactKind)] : []),
				...(input.status ? [eq(artifacts.status, input.status)] : [])
			)
		)
		.orderBy(desc(artifacts.updatedAt))
		.limit(1);

	return rows[0] ?? null;
}

export async function deleteArtifact(
	db: KgActionDb,
	input: string | { artifactId: string; actorAccountId?: string | null }
): Promise<void> {
	const artifactId = typeof input === 'string' ? input : input.artifactId;
	const actorAccountId = typeof input === 'string' ? null : input.actorAccountId;
	if (actorAccountId) {
		await assertArtifactMutableBy(db, { artifactId, accountId: actorAccountId });
	}

	await db.delete(artifacts).where(eq(artifacts.id, artifactId));
}

function assertArtifactNodeInput(input: CreateArtifactInput): void {
	if (
		input.node &&
		resolveNodeInputId(input.node) !== normalizeProtocolTermId(input.nodeId, 'nodeId')
	) {
		throw new Error('Artifact node input id must match nodeId.');
	}
}

function assertAttachArtifactNodeInput(input: AttachArtifactToNodeInput): void {
	if (
		input.node &&
		resolveNodeInputId(input.node) !== normalizeProtocolTermId(input.nodeId, 'nodeId')
	) {
		throw new Error('Artifact node input id must match nodeId.');
	}
}

function resolveNodeInputId(input: EnsureNodeInput): string {
	if (input.id) {
		return normalizeProtocolTermId(input.id, 'node.id');
	}

	const atomData = input.dataHex ?? input.data;
	if (!atomData) {
		throw new Error('Artifact node input requires id or atom data.');
	}

	return kgAtomId(atomData);
}

function stableJsonStringify(value: unknown): string {
	if (value === undefined) {
		return '"__undefined__"';
	}
	if (typeof value === 'bigint') {
		return JSON.stringify(value.toString());
	}
	if (typeof value === 'function' || typeof value === 'symbol') {
		return JSON.stringify(String(value));
	}
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map(stableJsonStringify).join(',')}]`;
	}

	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const entries = keys.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`);

	return `{${entries.join(',')}}`;
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

async function assertArtifactMutableBy(
	db: KgActionDb,
	input: { artifactId: string; accountId: string; allowMissing?: boolean }
): Promise<void> {
	const [artifact] = await db
		.select({ createdByAccountId: artifacts.createdByAccountId })
		.from(artifacts)
		.where(eq(artifacts.id, input.artifactId))
		.limit(1);

	if (!artifact) {
		if (input.allowMissing) {
			return;
		}
		throw notFound('Artifact not found.');
	}
	if (artifact.createdByAccountId && artifact.createdByAccountId !== input.accountId) {
		throw forbidden('Only the artifact owner can modify this artifact.');
	}
}

async function assertArtifactCreateOrUpdateAllowed(
	db: KgActionDb,
	input: { artifactId: string; accountId?: string | null }
): Promise<void> {
	const [artifact] = await db
		.select({ createdByAccountId: artifacts.createdByAccountId })
		.from(artifacts)
		.where(eq(artifacts.id, input.artifactId))
		.limit(1);

	if (!artifact || !artifact.createdByAccountId) {
		return;
	}
	if (!input.accountId || artifact.createdByAccountId !== input.accountId) {
		throw forbidden('Only the artifact owner can update this artifact.');
	}
}
