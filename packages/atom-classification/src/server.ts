import { type CreateClassificationEngineOptions, createClassificationEngine } from './engine';
import type { AtomClassificationPlugin } from './plugins';

export type CreateServerEngineOptions = Omit<CreateClassificationEngineOptions, 'runtime'> & {
	plugins?: AtomClassificationPlugin[];
};

export function createServerEngine(options: CreateServerEngineOptions = {}) {
	return createClassificationEngine({
		...options,
		runtime: 'server',
		plugins: options.plugins ?? [],
	});
}
