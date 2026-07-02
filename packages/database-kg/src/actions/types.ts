import type { KgDb } from '../client';
import type { KgRefType } from '../schema';

export type KgTransaction = Parameters<Parameters<KgDb['transaction']>[0]>[0];
export type KgActionDb = KgDb | KgTransaction;

export type KgActionRef = {
	type: KgRefType;
	id: string;
};

export type KgNodeRawType = 'string' | 'json' | 'http_uri' | 'ipfs_uri';

export type EnsureNodeInput = {
	id?: string;
	rawType: KgNodeRawType;
	classificationType: string;
	data?: string | null;
	dataHex?: string | null;
	dataResolved?: unknown;
	searchText?: string;
	createdBy?: string | null;
};

export type TripleInput = {
	subject: KgActionRef;
	predicate: KgActionRef;
	object: KgActionRef;
};

export type StatementInput = TripleInput & {
	userId: string;
	tripleId: string;
};

export type StatementBackedActionResult = {
	tripleId: string;
	subject: KgActionRef;
	predicate: KgActionRef;
	object: KgActionRef;
};

export function nodeRef(id: string): KgActionRef {
	return { type: 'node', id };
}

export function tripleRef(id: string): KgActionRef {
	return { type: 'triple', id };
}

export async function inKgTransaction<T>(
	db: KgActionDb,
	action: (tx: KgActionDb) => Promise<T>
): Promise<T> {
	if (hasTransaction(db)) {
		return db.transaction((tx) => action(tx));
	}

	return action(db);
}

function hasTransaction(db: KgActionDb): db is KgDb {
	return typeof (db as { transaction?: unknown }).transaction === 'function';
}
