# Design system (Operator v8, Apple-like with flow)

Reference implementation: `funnel/public/assets/site.css` (the v6–v8 blocks at the end are current).

## Tokens
| Token | Value | Use |
|---|---|---|
| white / paper | #ffffff / #f6f7fb | Page and quiet sections |
| ink / ink-2 | #0a0b14 / #2b2f45 | Headlines / body and sub copy (never mid-grey text) |
| grey / grey-2 / hair | #3e4463 / #5f6688 / #dfe2ee | Fine print, hints, dividers (blue-tinted, not neutral grey) |
| blue / violet / rose | #2f5bff / #6a4dff / #ff5c9a | Accents |
| flow | linear-gradient(95deg, #2f6bff, #6a4dff 38%, #b14dff 68%, #ff5c9a) | Headline payoff line, progress bar |
| btn | linear-gradient(100deg, #2f5bff, #5a4dff 55%, #8b4dff) | Buttons |

Type: **Inter** (variable with optical size, self-hosted, OFL) for everything; `font-feature-settings: "ss03"`. h1 660 weight, -0.028em, one scale site-wide `clamp(38px, 4.6vw, 60px)`. Fine print at 0 tracking. Mono only where code is shown.

Headline = an ink line plus a short gradient payoff (≤ 7 words) on its own line, rendered with `box-decoration-break: slice` so one gradient flows across wraps. Hyphenated words and short sentences are kept on one line (no-wrap spans).

## Rules
- Background flow, never decoration: a soft ambient aurora painted as the body background (colour at the edges, white centre) and one silk ribbon (`scripts/gen-flow.mjs`) that appears only from behind the film. Nothing behind body copy or form fields.
- The film is the hero: whole player above the fold on a 1440×900 laptop; dark poster with a bright white play button and a light halo.
- Application card: white, hairline border, soft shadow; inline progress bar that reveals one full-width gradient by step; "Step n of m"; option rows with keycaps and a clear hover.
- Buttons: pill, gradient, soft glow (none inside the card).
- Eyebrow: a quiet white chip with a violet dot.
- Motion only under `prefers-reduced-motion: no-preference`: hero fade-and-rise, ribbon sway, play hover scale.
- Mobile: single column at 760px, name fields side by side, no horizontal scroll, ribbon hidden.
- Video frames: use `contain: paint` on the player to avoid compositor seams.

## The product shot
Show the offer working: for a software/AI offer a macOS window with terminal lines appearing (staggered `animation-delay`) and a preview pane. For a service, use a dashboard or a timeline UI. For health, use a plan or report UI. Never use a stock photo.
