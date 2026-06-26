# Priority Feature List

This file tracks the dashboard feature order based on current progress and the remaining highest-value work.

## Status
The original first slice is completed, and the dashboard now also includes a second layer of research and curation tools.

## Completed Foundation
- Property filters and badges
- Width and height distribution charts
- `extlat` expansion-count ranking
- Same-lattice comparison across multiple `reslat` expansions
- Appendix-style statistics tables
- Count and ratio trend views
- Property checker
- Derived operation display
- Property co-occurrence matrix
- Constraint-driven browsing and shareable query state
- Export controls
- Blueprint curation with local SQLite-backed saved blueprints
- Blueprint search with unified browse/search controls and match explanations
- Smallest-example finder
- Shortlist compare
- Counter-gap analysis
- Design-language balance reports

## Implemented In
- [0bc338a](https://github.com/Tibex88/lattice-atlas/commit/0bc338a) adds property checker, derived operations, co-occurrence matrix, constraint URL state, and export controls.
- [444b492](https://github.com/Tibex88/lattice-atlas/commit/444b492) adds saved blueprint curation UI.

## Remaining Priorities

## 1. Why-Qualified View
Next because search results need a stronger, more explicit explanation layer, not just a compact match snippet, or else the workflow remains accurate but somewhat opaque.

## Why This Is Not Exhaustive
This is a priority order, not a full specification. It intentionally leaves out lower-priority workflow extras such as constraint presets, broader session/report tooling, behavior-to-node mapping, and catalog import/export.
