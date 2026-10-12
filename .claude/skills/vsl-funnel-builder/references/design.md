# Design system (Operator v4, Apple-tradisjon)

Reference: `claude-code-site/public/assets/op.css`.

## Tokens
| Token | Value | Use |
|---|---|---|
| white / paper | #ffffff / #f5f5f7 | Alternating light sections |
| ink / ink-2 / grey / hair | #1d1d1f / #424245 / #6e6e73 / #d2d2d7 | Text, secondary, dividers |
| black / on-dark / on-dark-2 | #000 / #f5f5f7 / #a1a1a6 | Film, guarantee, closer |
| blue / blue-hi | #0a62d6 / #2997ff | One accent: buttons, links, progress |
| green | #1a8a4a | Checks and "live" states only |

Type: **Geist** for display and text, **Geist Mono** for terminal/UI. Headlines are 600 weight with tight tracking (-.04em). The second line of a headline goes in grey.

## Rules
- One accent colour. Black sections create rhythm; no gradients on surfaces.
- Bento tiles: radius 28px, mini UIs that show the deliverable (not icons).
- Buttons: pill, solid blue, subtle sheen every ~5s. The secondary action is a text link with ›.
- Figures: big numbers, thin left dividers, no boxes.
- Forms: 12px radius inputs, blue focus ring, 5 steps with a thin progress bar.
- Content is visible at rest; reveal animations only under `.js`, plus `prefers-reduced-motion`.
- Mobile: single column at 760px; the terminal preview hides; there is no horizontal scroll.

## The product shot
Show the offer working: for a software/AI offer a macOS window with terminal lines appearing (staggered `animation-delay`) and a preview pane. For a service, use a dashboard or a timeline UI. For health, use a plan or report UI. Never use a stock photo.
