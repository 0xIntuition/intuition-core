import { type CreateClassificationEngineOptions, createClassificationEngine } from './engine';
import type { AtomClassificationPlugin } from './plugins';

export type CreateClientEngineOptions = Omit<CreateClassificationEngineOptions, 'runtime'> & {
	plugins?: AtomClassificationPlugin[];
};

export function createClientEngine(options: CreateClientEngineOptions = {}) {
	return createClassificationEngine({
		...options,
		runtime: 'client',
		plugins: options.plugins ?? [],
	});
}
