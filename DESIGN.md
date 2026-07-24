# Design Brief

## Direction

Calibrated Ink Terminal — a dark, instrument-panel research tool that reads like a Bloomberg terminal crossed with Swiss editorial typography. Extended for multi-file dataset management and cross-timeframe correlation analysis.

## Tone

Brutalist-precise and scientific: deep ink-black canvas, sharp 4px radii, no fluffy shadows, electric-green used only for active states and key metrics. The UI behaves like a calibrated measurement instrument, not a SaaS dashboard.

## Differentiation

All numeric data renders in JetBrains Mono with tabular figures, so win rates, row counts, aligned timestamps, and confidence bars align like a ticker tape — the entire app reads as a quant workstation rather than a generic admin panel.

## Color Palette

| Token            | OKLCH (dark)   | Role                                          |
| ---------------- | -------------- | --------------------------------------------- |
| background       | 0.14 0.008 240 | ink-black canvas                              |
| foreground       | 0.93 0.006 240 | primary text                                  |
| card             | 0.175 0.01 240 | elevated surfaces, dataset cards, tables      |
| primary          | 0.82 0.2 145   | electric green — active, Run, key KPI        |
| accent           | 0.82 0.2 145   | highlights, active tab underline             |
| muted            | 0.2 0.01 240   | secondary panels, filter sidebars            |
| depth-light      | 0.8 0.12 75    | light depth selector (2-4 conditions) — amber |
| depth-deep       | 0.82 0.2 145   | deep depth selector (5-6 conditions) — green |
| dataset-stripe   | 0.2 0.012 240  | alternating dataset card stripe               |
| correlation-cell  | 0.82 0.2 145   | shared-dataset row link tint in cross-ref    |
| warning          | 0.8 0.15 70    | out-of-sample degradation flags               |
| destructive      | 0.62 0.22 25   | failed patterns, negative moves               |
| chart-1..5       | green/amber/red/blue/violet | outcome histograms, distributions |

## Typography

- Display: Space Grotesk — headings, tab labels, app title, dataset labels
- Body: DM Sans — paragraphs, descriptions, plain-English detected conditions
- Mono: JetBrains Mono — every numeric cell, row count, timestamp, metric value, column-preview chips
- Scale: hero `text-4xl font-bold tracking-tight`, h2 `text-2xl font-semibold`, label `text-xs font-semibold tracking-widest uppercase`, body `text-sm`

## Elevation & Depth

Flat instrument aesthetic — `shadow-subtle` for cards, `shadow-elevated` only for popovers/modals. Hierarchy comes from background lightness steps (background < card < popover), not shadows. Dataset cards add a 2px inset green left-border for the active selection instead of a shadow.

## Structural Zones

| Zone                  | Background         | Border          | Notes                                       |
| --------------------- | ------------------ | --------------- | ------------------------------------------- |
| Header                | bg-card            | border-b        | app title, dataset pill, Load Data          |
| Tabs                  | bg-card            | border-b        | tabs incl. Datasets + Cross-Reference       |
| Content               | bg-background      | —               | alternating bg-muted/30 for sub-sections    |
| Dataset List          | bg-background      | —               | grid of dataset-card, active = inset green  |
| Depth-Range Selector  | bg-muted/30        | border-y        | light (amber) vs deep (green) chip groups   |
| Cross-Reference Table | bg-card            | border          | sticky header, zebra rows, linked-row tint  |
| Sidebar               | bg-muted           | border-r        | filter controls, feature catalog            |
| Footer                | bg-muted/40        | border-t        | research summary, dataset meta              |

## Spacing & Rhythm

Compact density: section gaps `gap-6`, dataset card grid `gap-3`, content grouping `gap-3`, table rows `py-2.5`, micro-spacing `gap-1`. Tighter than a typical SaaS layout to maximize data per viewport.

## Component Patterns

- Buttons: sharp 4px radius, primary = bg-primary text-primary-foreground, secondary = bg-secondary border
- Cards: 4px radius, bg-card, border, shadow-subtle, no hover lift
- Dataset Cards: 4px radius, bg-card (alt rows bg dataset-stripe), label in Space Grotesk, row-count mono badge top-right, column-preview chips (.column-chip, mono, original names preserved), active = inset 2px green left-border
- Depth Selector: two grouped chip rows — `.depth-light-chip` (amber, 2-4) and `.depth-deep-chip` (green, 5-6), active chip filled, inactive outlined; clear visual gap between groups
- Cross-Reference Table: mono numeric cells, tabular-nums, sticky headers, zebra rows via bg-muted/30, rows sharing a contributing dataset get `.correlation-row-linked` (inset 2px green left tint), inline green confidence bars
- Badges: 4px radius, mono font, color-coded (success/warning/destructive) for win-rate and confidence tiers

## Motion

- Entrance: `count-up` 0.35s on metric cards, `row-reveal` 0.3s staggered on dataset list cards when loaded
- Progress: `scan-line` 1.4s sweep across progress bars during discovery
- Hover: `transition-smooth` 0.3s on rows and tabs, no transform
- Decorative: `pulse-soft` 1.6s on the active "Running" status dot

## Constraints

- No gradients, no rounded pill buttons, no purple, no corporate navy
- Green is reserved for active states, primary metrics, and deep-depth selector — never decorative
- Amber (depth-light) is reserved exclusively for the light depth group — never reused elsewhere
- Dark mode is the primary mode; light mode is functional parity only
- Numeric data always mono + tabular-nums; prose always DM Sans
- Original column names with spaces/special chars preserved verbatim in column-preview chips

## Signature Detail

The cross-timeframe correlation table: rows sharing a contributing dataset are stitched together by a 2px inset green left-border tint, while aligned timestamps and confidence bars render on a JetBrains Mono decimal grid — the whole readout looks like a calibrated multi-channel instrument trace, the unmistakable signature of a quant research terminal.

## Discovery Phase Components

### MFE/MAE Mode Segment (.mode-segment)

Three-position ratio filter: Off / Positive only / Auto-find. Inline-flex segmented control on bg-muted with 2px padding; active segment fills bg-primary text-primary-foreground, inactive segments are muted-foreground. Display font, 4px radius. Used for both the MFE/MAE ratio filter and the hold-window auto-find control — same visual grammar, same three modes.

### Auto-Find Probe Result (.probe-result + .probe-bracket-bar)

When Auto-find is selected, a probe card reports the loosest and strictest viable settings that yield results. A 6px bracket bar spans the full range with the viable window filled by --probe-bracket (electric green) via CSS vars --bracket-start / --bracket-end. The fill animates with bracket-expand (0.5s scaleX from left). Loosest/strictest values render in mono tabular-nums at each end of the bar.

### Per-Feature Range Tuning (.bucket-input)

Numeric override inputs sit beside each auto-quartile bucket boundary. Mono tabular-nums, 4px radius, 5.5rem width. Default state is bg-background border-border; when a manual override is active ([data-override="true"]) the input tints to depth-light (amber) at 6% to signal "user-set, not auto." Focus ring is primary green.

### Saved-Runs List (.run-card)

Flat instrument cards for each saved discovery run: name, timestamp, dataset, pattern count, key config. 4px radius, bg-card, border. Selected for single view = inset 2px green left-border + primary border. Selected for compare ([data-compare="true"]) = inset 2px amber left-border + depth-light border, so the two compare selections are visually distinct from a single-view selection.

### Compare View Diff Tints (.diff-added / .diff-removed / .diff-changed)

Side-by-side config diff between two or more saved runs. Cell backgrounds tint at 14% opacity: green for added configs, red for removed, amber for changed values. Text color matches the tint. diff-flash animation (0.8s) pulses newly-changed cells on view entry. All diff values render in mono tabular-nums.

### Validation Status Pills (.surviving / .degraded)

Out-of-sample validation summary distinguishes surviving vs degraded patterns. Pills are mono uppercase 11px, 4px radius, 16% background tint with 40% border tint. Surviving = green (--surviving), Degraded = amber (--degraded). Direction-adjusted MFE/MAE ratio accompanies each pill in mono tabular-nums.

### Consolidated Report Stat Cards (.stat-card)

Coverage stat cards per top pattern: data span, occurrences per symbol/timeframe, concentration flags, direction-adjusted MFE/MAE ratio, confidence. 4px radius, bg-card, border. Key metric card ([data-accent="true"]) gets inset 2px green left-border to anchor the report. All metrics mono tabular-nums.

## Discovery Motion

- Probe bracket fill: `bracket-expand` 0.5s scaleX-from-left when auto-find results render
- Compare diff cells: `diff-flash` 0.8s pulse on newly-changed cells when compare view opens
- Existing count-up / row-reveal / scan-line / pulse-soft remain in effect for metric cards, run lists, progress, and status dots
