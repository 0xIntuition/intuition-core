# Widget Brief — the embeddable Intuition card

*Self-contained context for Part 3 of the take-home. The prototype lives in a
private repo; everything you need to reason about it is below.*

## What it is

An embeddable widget that carries the Intuition Knowledge Graph onto any
website — an **item**, a **stack** (curated collection), a **claim**
(subject → predicate → object), or its live **market** data — in one paste.

### The marquee variant: the Market Widget

The fullest expression of a card. For any graph item (an app like Next.js, a
token like Ether, a person like Ada Lovelace) it renders:

- **Identity** — image, classification badge (`SOFTWAREAPPLICATION`, `TOKEN`,
  `PERSON`, …), title, subtitle
- **A live Trust/TVL sparkline** with a % change chip
- **Total Trust** (e.g. `322.5 Ŧ`) and a row of **supporter avatars** (`+137`)
- **A "TRUST" CTA button** — the on-ramp from a third-party page into an
  Intuition transaction
- A **"Powered by Intuition"** footer mark — the brand loop
- Dark and light themes

> A screenshot export of the three market cards (Next.js / Ether / Ada
> Lovelace, dark + light) belongs in `assets/market-widget.png` — re-export
> from the design playground if missing.

## Two delivery mechanisms (same rendering core)

**1. iframe + loader (default — zero conflict):**

```html
<div class="intuition-widget"
  data-type="item"
  data-id="0x91ab…02ce"
  data-variant="market"
  data-theme="dark"></div>
<script async src="https://embed.intuition.systems/v1.js"></script>
```

The loader finds every `.intuition-widget` element, injects a sandboxed
`<iframe>`, and auto-resizes it via `postMessage`. Host CSS/JS can't touch the
widget and vice versa. It re-scans the DOM for widgets added later.

**2. Web component (native DOM):**

```html
<script type="module" src="https://embed.intuition.systems/v1.mjs"></script>
<intuition-widget type="item" id="0x91ab…02ce" variant="market" theme="dark"></intuition-widget>
```

Renders into a shadow root — style-isolated, no iframe.

## The widget API (prototype)

A standalone, **read-only, no-auth** REST service, separate from the main API
gateway (whose credentialed CORS allowlist would block arbitrary origins).
Design properties, all deliberate:

- **Permissive CORS (`*`)** — every response is public read-only graph data,
  served without cookies or auth
- **Pre-shaped tiny DTOs** — client needs no adapter
- **CDN cache headers** — embed traffic absorbed at the edge
- **Single KG database connection** — identity/image from `kg.nodes` +
  `kg.artifacts`, TVL/holders from `market.vaults`; no Timescale needed
- **Sample fallback** — serves believable data with no DB, so the embed never
  renders broken

| Route | Returns |
| --- | --- |
| `GET /v1/item/:id` | id, type, title, subtitle, classification, imageUrl, trust, stakers, marketCap, sharePrice |
| `GET /v1/stack/:id` | title, cover images, itemCount, trust, stakers |
| `GET /v1/claim/:id` | subject / predicate / object, trustFor, trustAgainst, supporters |

## Status

All of it is a **working prototype**: the loader, the web component, an
interactive embed-builder host site running against live testnet data, and a
design playground covering ~20 classifications, card sizes, themes, and an
expanded full-screen state with a signal-market chart. None of it is deployed,
versioned, rate-limited, or hardened for third-party production traffic.

## The strategic hook

The widget is a possible **product on top of Intuition Core**: the widget API
reads the same KG database Core ships, so anyone running Core could serve
widgets — or Intuition could run it as a hosted, eventually paid, service for
partners. Where it lands is part of what we're asking you to decide.
