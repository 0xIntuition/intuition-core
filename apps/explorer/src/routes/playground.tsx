import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { KeyRound, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/app-shell';
import { JsonViewer } from '@/components/ui/json-viewer';
import { Button, Card, CardHeader, ErrorNote, Input, Select } from '@/components/ui/primitives';
import { api, buildCurl } from '@/lib/api';
import { previewData } from '@/lib/format';

export const Route = createFileRoute('/playground')({
	component: PlaygroundPage,
});

const API_KEY_STORAGE = 'explorer-api-key';

function PlaygroundPage() {
	const [apiKey, setApiKey] = useState('');
	useEffect(() => {
		setApiKey(localStorage.getItem(API_KEY_STORAGE) ?? '');
	}, []);
	const saveApiKey = (value: string) => {
		setApiKey(value);
		localStorage.setItem(API_KEY_STORAGE, value);
	};

	return (
		<>
			<PageHeader
				description="Write to your node through the same public API any app would use. Each form shows its exact curl equivalent."
				title="Playground"
			/>

			<Card className="mb-3">
				<div className="flex items-center gap-2.5 px-4 py-3">
					<KeyRound className="size-4 text-faint" />
					<Input
						className="w-96 font-mono"
						onChange={(event) => saveApiKey(event.target.value)}
						placeholder="ik_… API key (optional when the node runs API_AUTH=open)"
						type="password"
						value={apiKey}
					/>
					<span className="text-[11px] text-faint">
						stored in localStorage only · mint one with <code className="font-mono">make keys</code>
					</span>
				</div>
			</Card>

			<div className="grid gap-3 lg:grid-cols-2">
				<CreateAtomCard apiKey={apiKey || undefined} />
				<CreateTripleCard apiKey={apiKey || undefined} />
			</div>
		</>
	);
}

function CreateAtomCard({ apiKey }: { apiKey?: string }) {
	const [input, setInput] = useState('');
	const mutation = useMutation({
		mutationFn: () => api.createAtom(input, apiKey),
	});

	const curl = useMemo(
		() => buildCurl({ path: '/api/atoms', method: 'POST', body: { input: input || '…' }, apiKey }),
		[input, apiKey]
	);

	return (
		<Card>
			<CardHeader hint="POST /api/atoms" title="Create atom" />
			<div className="space-y-3 p-4">
				<p className="text-[12px] text-muted">
					Any URL, string, or JSON. The atom ID is derived from the bytes — posting the same input
					twice returns the same atom. Workers parse, classify, and enrich it automatically.
				</p>
				<textarea
					className="min-h-24 w-full rounded-md border border-border bg-surface-raised p-2.5 font-mono text-[12.5px] placeholder:text-faint focus:border-accent/60 focus:outline-none"
					onChange={(event) => setInput(event.target.value)}
					placeholder={'https://github.com/oven-sh/bun\nor {"@type":"Person","name":"Ada"}'}
					value={input}
				/>
				<div className="flex items-center gap-2">
					<Button
						disabled={!input.trim() || mutation.isPending}
						onClick={() => mutation.mutate()}
						variant="primary"
					>
						<Send className="size-3.5" />
						{mutation.isPending ? 'Creating…' : 'Create atom'}
					</Button>
					{mutation.data ? (
						<span className="text-[12px] text-success">
							{mutation.data.data.created ? 'created' : 'already existed'} →{' '}
							<Link
								className="font-mono underline"
								params={{ atomId: mutation.data.data.id }}
								to="/atoms/$atomId"
							>
								{previewData(mutation.data.data.id, 24)}
							</Link>
						</span>
					) : null}
				</div>
				{mutation.error ? <ErrorNote error={mutation.error} /> : null}
				<details open>
					<summary className="cursor-pointer text-[11px] text-faint hover:text-foreground">
						curl equivalent
					</summary>
					<div className="mt-1.5">
						<JsonViewer value={curl} />
					</div>
				</details>
			</div>
		</Card>
	);
}

function CreateTripleCard({ apiKey }: { apiKey?: string }) {
	const [subjectId, setSubjectId] = useState('');
	const [predicateId, setPredicateId] = useState('');
	const [objectId, setObjectId] = useState('');

	const predicates = useQuery({ queryKey: ['predicates'], queryFn: () => api.predicates() });

	const mutation = useMutation({
		mutationFn: () =>
			api.createTriple(
				{ subject_id: subjectId, predicate_id: predicateId, object_id: objectId },
				apiKey
			),
	});

	const curl = useMemo(
		() =>
			buildCurl({
				path: '/api/triples',
				method: 'POST',
				body: {
					subject_id: subjectId || '0x…',
					predicate_id: predicateId || '0x…',
					object_id: objectId || '0x…',
				},
				apiKey,
			}),
		[subjectId, predicateId, objectId, apiKey]
	);

	const complete = subjectId.trim() && predicateId.trim() && objectId.trim();

	return (
		<Card>
			<CardHeader hint="POST /api/triples" title="Create triple" />
			<div className="space-y-3 p-4">
				<p className="text-[12px] text-muted">
					Claim a subject → predicate → object relationship between existing terms. Paste atom IDs
					from the atoms table; the predicate can come from the registry.
				</p>
				<Input
					className="w-full font-mono"
					onChange={(event) => setSubjectId(event.target.value)}
					placeholder="subject_id (0x…)"
					value={subjectId}
				/>
				<div className="flex gap-2">
					<Input
						className="flex-1 font-mono"
						onChange={(event) => setPredicateId(event.target.value)}
						placeholder="predicate_id (0x…)"
						value={predicateId}
					/>
					<Select
						className="w-44"
						onChange={(event) => {
							if (event.target.value) {
								setPredicateId(event.target.value);
							}
						}}
						value=""
					>
						<option value="">registry…</option>
						{(predicates.data?.data ?? []).map((predicate) => (
							<option key={predicate.id} value={predicate.id}>
								{predicate.slug ?? predicate.id.slice(0, 12)}
							</option>
						))}
					</Select>
				</div>
				<Input
					className="w-full font-mono"
					onChange={(event) => setObjectId(event.target.value)}
					placeholder="object_id (0x…)"
					value={objectId}
				/>
				<div className="flex items-center gap-2">
					<Button
						disabled={!complete || mutation.isPending}
						onClick={() => mutation.mutate()}
						variant="primary"
					>
						<Send className="size-3.5" />
						{mutation.isPending ? 'Creating…' : 'Create triple'}
					</Button>
					{mutation.data ? (
						<span className="text-[12px] text-success">
							{mutation.data.data.created ? 'created' : 'already existed'} →{' '}
							<Link
								className="font-mono underline"
								params={{ tripleId: mutation.data.data.id }}
								to="/triples/$tripleId"
							>
								{previewData(mutation.data.data.id, 24)}
							</Link>
						</span>
					) : null}
				</div>
				{mutation.error ? <ErrorNote error={mutation.error} /> : null}
				<details>
					<summary className="cursor-pointer text-[11px] text-faint hover:text-foreground">
						curl equivalent
					</summary>
					<div className="mt-1.5">
						<JsonViewer value={curl} />
					</div>
				</details>
			</div>
		</Card>
	);
}
