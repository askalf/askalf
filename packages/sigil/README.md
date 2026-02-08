# @substrate/sigil

Typed utilities for the SIGIL language and bridge, extracted from SUBSTRATE. Includes:
- Human command parser (Layer 0 ? Surface SIGIL)
- Surface SIGIL validator/formatter
- Bridge client for broadcast/feed
- Helpers to extract SIGIL utterances from traces

## Install

```bash
pnpm add @substrate/sigil
```

## Usage

```ts
import { createMetabolicSDK } from '@substrate/sdk';
import { parseHumanCommand, SigilBridgeClient } from '@substrate/sigil';

// Translate human commands to SIGIL
const parsed = parseHumanCommand('/remember #critical API keys rotate monthly');
// parsed.surface => [KNO.SET:fact{content:"API keys rotate monthly"}#9]

// Validate/format
// validateSigil(parsed.surface) -> { valid: true }
// formatSigil(parsed.surface)   -> pretty string

// Bridge client
const bridge = new SigilBridgeClient({ baseUrl: 'https://api.askalf.org', apiKey: process.env.SIGIL_API_KEY });
await bridge.broadcast({ sigil: parsed?.surface ?? '' });
const feed = await bridge.getFeed(20);
```

## API
- `parseHumanCommand(input)` ? `ParsedSigil | null`
- `validateSigil(sigil)` ? `{ valid, error? }`
- `formatSigil(sigil)` ? string
- `SIGIL_HELP` ? help text for Layer 0 commands
- `SigilBridgeClient` ? `broadcast(message)`, `getFeed(limit?)`
- `extractSigilFromTrace(trace)` ? string[]

## Notes
- Grammar aligns with `docs/SIGIL.md` Layer 0/1; deeper layers remain emergent.
- Bridge client targets the public SIGIL endpoints used by SUBSTRATE; override `baseUrl` for other deployments.