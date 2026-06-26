# Feature: Property Filters and Badges

## Goal
Let users filter structures by named algebraic properties and see those properties attached to each structure.

## What It Should Show
- Property badges per selected structure
- Filters for common properties such as modularity, distributivity, prelinearity, BL, MTL, divisibility, involution

## Why It Matters
The paper's later sections are heavily about frequency and combinations of properties.

## Suggested UI
- Badge row on each pane
- Sidebar or modal filter controls
- Result counts after filtering

## UI Shape
- A filter drawer or sidebar with grouped property checkboxes
- Colored badges under each selected structure title
- Live result counts updating as filters change

## Data Needed
- Property evaluators over decoded structures
- Optional precomputed property tables for speed

## Status
Completed for the current milestone.

## Implemented In
- [64a98df](https://github.com/Tibex88/lattice-atlas/commit/64a98df) Build filter and analysis UI
- [09645fb](https://github.com/Tibex88/lattice-atlas/commit/09645fb) Add resilient api layer and item metadata caching
- [259d538](https://github.com/Tibex88/lattice-atlas/commit/259d538) Add frontend loading states and property help
