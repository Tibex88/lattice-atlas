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

## Implemented In
- [0bc338a](https://github.com/Tibex88/lattice-atlas/commit/0bc338a) adds property checker, derived operations, co-occurrence matrix, constraint URL state, and export controls.
- [444b492](https://github.com/Tibex88/lattice-atlas/commit/444b492) adds saved blueprint curation UI.

## Remaining Priorities

## 1. Blueprint Search
Highest priority because the workbench still needs a direct way to ask for shapes by dimensions, algebraic properties, and expansion behavior instead of relying on paging and manual filter iteration.

## 2. Why-Qualified View
Next because search results need a short explanation of why each shape matched, or else the workflow becomes accurate but opaque.

## 3. Smallest-Example Finder
High priority because it gives canonical examples fast and supports a more disciplined “find the minimal witness” workflow when exploring constraints.

## 4. Shortlist Compare
Comes next because saved blueprints are already in place, but they still need a more deliberate compare mode to make curation decisions efficient.

## 5. Counter-Gap Analysis
After search and comparison, this becomes valuable because it starts turning chosen shapes into structural design guidance by identifying missing or weak regions.

## 6. Design-Language Balance Reports
This stays after counter-gap analysis because it is a more synthesized, design-facing summary built on top of strong search, inspection, and comparison workflows.

## Why This Is Not Exhaustive
This is a priority order, not a full specification. It intentionally leaves out lower-priority workflow extras such as constraint presets, broader session/report tooling, behavior-to-node mapping, and catalog import/export.
