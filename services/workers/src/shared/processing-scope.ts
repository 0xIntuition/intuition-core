export const PROCESSING_SCOPE_PRESETS = [
	'full',
	'music',
	'podcasts',
	'music-and-podcasts',
] as const;

export type ProcessingScopePreset = (typeof PROCESSING_SCOPE_PRESETS)[number];

export type ProcessingDomain = 'music' | 'podcast';

export function getProcessingScopeDomains(
	scope: ProcessingScopePreset
): readonly ProcessingDomain[] | undefined {
	switch (scope) {
		case 'full':
			return undefined;
		case 'music':
			return ['music'];
		case 'podcasts':
			return ['podcast'];
		case 'music-and-podcasts':
			return ['music', 'podcast'];
	}
}
