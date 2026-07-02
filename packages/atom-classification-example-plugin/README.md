# @0xintuition/atom-classification-example-plugin

Minimal external plugin example for `@0xintuition/atom-classification`.

## What it does

- Classifies inputs that start with `idea:`
- Resolves them into a deterministic `DefinedTerm` atom

Example:

`idea: semantic grounding` -> `example-term:semantic-grounding`

## Usage

```ts
import {
	createServerEngine,
	defaultClassificationPreset,
} from '@0xintuition/atom-classification';
import { createExampleLexicalSignalPlugin } from '@0xintuition/atom-classification-example-plugin';

const engine = createServerEngine({
	plugins: [...defaultClassificationPreset(), createExampleLexicalSignalPlugin()],
});

const result = await engine.classify({
	input: 'idea: semantic grounding',
	mode: 'progressive',
	classificationSessionId: 'demo-session',
});
```
