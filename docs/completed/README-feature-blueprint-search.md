# Feature: Constraint-Based Blueprint Search

## Goal
Search for blueprints using structure-level criteria instead of manual browsing alone.

## What It Should Show
- Candidate shapes by width, height, and property set
- Optional `extlat` expansion thresholds
- Ranked search results

## Why It Matters
The current filters help inspect structures, but a shape-first workflow needs a stronger way to ask for the kind of blueprint the designer wants.

## Suggested UI
- Search mode inside the shared controls area
- Ranked result list
- Quick actions to save or compare returned blueprints

## UI Shape
- A mode switch that turns the main controls area from browse mode into blueprint-search mode
- Shared dataset/size/filter controls so browse and search stay in one workflow
- Ranked cards with key metrics and property badges
- Short explanatory snippets for why each result matched

## Data Needed
- Indexed structure metadata across datasets
- Search heuristics or ranking rules for blueprint quality

## Status
Completed for the current milestone.

## Implemented In
- [7d76e45](https://github.com/Tibex88/lattice-atlas/commit/7d76e45) Add blueprint search workflow
