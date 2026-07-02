export type PlainTextInputMatch = {
	value: string;
	tokens: string[];
	tokenCount: number;
	characterCount: number;
};

const NORMALIZED_LEXICAL_TERM_REGEX = /^[a-z]+(?:['-][a-z]+)*$/;

export function matchPlainTextInput(input: string): PlainTextInputMatch | null {
	const value = normalizeWhitespace(input);
	if (value.length === 0) {
		return null;
	}

	if (value.startsWith('{') || value.startsWith('[')) {
		return null;
	}

	if (value.includes('://')) {
		return null;
	}

	const tokens = value.split(' ').filter(Boolean);
	return {
		value,
		tokens,
		tokenCount: tokens.length,
		characterCount: value.length,
	};
}

export function normalizeLexicalTerm(input: string): string | null {
	const match = matchPlainTextInput(input);
	if (!match || match.tokenCount !== 1) {
		return null;
	}

	const normalized = match.value.toLowerCase();
	return NORMALIZED_LEXICAL_TERM_REGEX.test(normalized) ? normalized : null;
}

function normalizeWhitespace(input: string): string {
	return input.trim().replace(/\s+/g, ' ');
}
