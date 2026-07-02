import { z } from 'zod/v4';

export const dictionaryDataSchema = z.object({
	word: z.string(),
	phonetic: z.string().optional(),
	audioUrl: z.string().url().optional(),
	meanings: z.array(
		z.object({
			partOfSpeech: z.string(),
			definitions: z.array(
				z.object({
					definition: z.string(),
					example: z.string().optional(),
					synonyms: z.array(z.string()).optional(),
					antonyms: z.array(z.string()).optional(),
				})
			),
		})
	),
	sourceUrl: z.string().url().optional(),
});

export type DictionaryData = z.infer<typeof dictionaryDataSchema>;
