import { calculateAtomId, calculateTripleId } from '@0xintuition/ids';
import {
	MultiVaultAbi,
	multiVaultCreateAtomsWithUrisEncode,
	multiVaultValidateCreateAtomsWithUris,
} from '@0xintuition/protocol';
import {
	encodeAbiParameters,
	encodeEventTopics,
	isHex,
	stringToHex,
	toEventSelector,
	toFunctionSelector,
} from 'viem';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const protocolPackage = await import('@0xintuition/protocol/package.json', {
	with: { type: 'json' },
});
const protocolRoot = new URL('./node_modules/@0xintuition/protocol/', import.meta.url).href;
for (const entry of ['@0xintuition/protocol', '@0xintuition/protocol/package.json']) {
	assert(import.meta.resolve(entry).startsWith(protocolRoot), `${entry} escaped the consumer`);
}
assert(
	JSON.stringify(Object.keys(protocolPackage.default.exports).sort()) ===
		JSON.stringify(['.', './package.json']),
	'Unexpected public protocol entrypoints'
);
let deepImportRejected = false;
try {
	await import('@0xintuition/protocol/src/index.js');
} catch {
	deepImportRejected = true;
}
assert(deepImportRejected, 'Protocol source import was admitted');
for (const [name, value] of Object.entries({
	MultiVaultAbi,
	multiVaultCreateAtomsWithUrisEncode,
	multiVaultValidateCreateAtomsWithUris,
	calculateAtomId,
	calculateTripleId,
})) {
	assert(name === 'MultiVaultAbi' ? Array.isArray(value) : typeof value === 'function', name);
}
for (const name of ['ids', 'curves']) {
	assert(
		import.meta
			.resolve(`@0xintuition/${name}`)
			.startsWith(new URL(`./node_modules/@0xintuition/${name}/`, import.meta.url).href),
		`${name} escaped the installed tarball`
	);
}

const functionItem = MultiVaultAbi.find(
	(item) => item.type === 'function' && item.name === 'createAtomsWithUris'
);
const eventItem = MultiVaultAbi.find(
	(item) => item.type === 'event' && item.name === 'AtomContextRegistered'
);
assert(functionItem && eventItem, 'Train ABI is missing URI creation items');
const creator = '0x1111111111111111111111111111111111111111';
const atoms = [
	{ kind: 'string', input: 'Intuition URI conformance' },
	{ kind: 'url', input: 'https://example.com/atoms/uri-conformance' },
	{ kind: 'raw-bytes', input: '0x00ff1020' },
	{ kind: 'json', input: '{"@type":"Book","name":"URI conformance"}' },
].map((atom) => ({ ...atom, data: isHex(atom.input) ? atom.input : stringToHex(atom.input) }));

function vector(name, selected, uriTexts) {
	const data = selected.map((atom) => atom.data);
	const assets = selected.map((_, index) => BigInt(index + 1));
	const uris = uriTexts.map((entries) => entries.map((entry) => stringToHex(entry)));
	const value = assets.reduce((sum, asset) => sum + asset, 0n);
	const inputs = { args: [creator, data, assets, uris], value };
	multiVaultValidateCreateAtomsWithUris(inputs);
	const calldata = multiVaultCreateAtomsWithUrisEncode(inputs);
	const termIds = selected.map((atom) => calculateAtomId(atom.input));
	return {
		name,
		atoms: selected,
		inputs: { creator, data, assets: assets.map(String), uris, uriTexts, value: String(value) },
		calldata,
		selector: calldata.slice(0, 10),
		termIds,
		topic0: toEventSelector(eventItem),
		logs: termIds.map((termId, index) => ({
			termId,
			topics: encodeEventTopics({
				abi: [eventItem],
				eventName: 'AtomContextRegistered',
				args: { termId, registrant: creator },
			}),
			data: encodeAbiParameters(
				eventItem.inputs.filter((input) => !input.indexed),
				[uris[index]]
			),
		})),
	};
}

const vectors = atoms.flatMap((atom, index) => [
	vector(`${atom.kind}-one-uri`, [atom], [[`int:wd:book:Q${index + 42}`]]),
	vector(
		`${atom.kind}-two-uris`,
		[atom],
		[[`int:wd:book:Q${index + 42}`, `https://example.com/context/${index}`]]
	),
]);
vectors.push(
	vector(
		'mixed-three-atom-batch',
		[atoms[2], atoms[0], atoms[3]],
		[['https://example.com/raw', 'int:wd:book:Q44'], ['int:wd:book:Q42'], []]
	)
);

const validArgs = [creator, [atoms[0].data], [1n], [[stringToHex('int:wd:book:Q42')]]];
const malformed = [
	['misaligned-uris', { args: [creator, validArgs[1], [1n], []], value: 1n }],
	['misaligned-assets', { args: [creator, validArgs[1], [], validArgs[3]], value: 0n }],
	['zero-creator', { args: [`0x${'0'.repeat(40)}`, ...validArgs.slice(1)], value: 1n }],
	['empty-batch', { args: [creator, [], [], []], value: 0n }],
	['wrong-value', { args: validArgs, value: 0n }],
	[
		'uri-count-limit',
		{ args: validArgs, value: 1n, uriLimits: { maxUriCount: 0n, maxUriLength: 100n } },
	],
	[
		'uri-byte-length-limit',
		{ args: validArgs, value: 1n, uriLimits: { maxUriCount: 1n, maxUriLength: 14n } },
	],
];
const rejections = malformed.map(([name, inputs]) => {
	let reason;
	try {
		multiVaultValidateCreateAtomsWithUris(inputs);
	} catch (error) {
		reason = error.message;
	}
	assert(reason, `Validator admitted ${name}`);
	let builderReason;
	try {
		multiVaultCreateAtomsWithUrisEncode(inputs);
	} catch (error) {
		builderReason = error.message;
	}
	assert(builderReason === reason, `Builder bypassed validation for ${name}`);
	return { name, reason };
});
// Exactly-at-limit input must remain admissible; lengths are bytes, not hex characters.
multiVaultValidateCreateAtomsWithUris({
	args: validArgs,
	value: 1n,
	uriLimits: { maxUriCount: 1n, maxUriLength: 15n },
});

process.stdout.write(
	`${JSON.stringify({
		publicEntrypoints: {
			protocolVersion: protocolPackage.default.version,
			exports: Object.keys(protocolPackage.default.exports).sort(),
			deepImportRejected,
			installedTarballsOnly: true,
		},
		abi: { functionItem, eventItem },
		selector: toFunctionSelector(functionItem),
		topic0: toEventSelector(eventItem),
		vectors,
		rejections,
	})}\n`
);
