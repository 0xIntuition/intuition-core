import { z } from 'zod/v4';

export const trustCategorySchema = z.enum([
	'technology',
	'design',
	'music',
	'books',
	'film',
	'coffee',
	'finance',
	'gaming',
	'sports',
	'food',
	'fashion',
	'art',
	'travel',
	'science',
	'health',
	'crypto',
]);

export const TRUST_CIRCLE_CATEGORIES = trustCategorySchema.options;

export type TrustCircleCategory = (typeof TRUST_CIRCLE_CATEGORIES)[number];
export type Interest = TrustCircleCategory;

export const TRUST_CIRCLE_LABELS = {
	technology: 'Technology',
	design: 'Design',
	music: 'Music',
	books: 'Books',
	film: 'Film',
	coffee: 'Coffee',
	finance: 'Finance',
	gaming: 'Gaming',
	sports: 'Sports',
	food: 'Food',
	fashion: 'Fashion',
	art: 'Art',
	travel: 'Travel',
	science: 'Science',
	health: 'Health',
	crypto: 'Crypto',
} as const satisfies Record<TrustCircleCategory, string>;

export function isTrustCircleCategory(value: string): value is TrustCircleCategory {
	return (TRUST_CIRCLE_CATEGORIES as readonly string[]).includes(value);
}
