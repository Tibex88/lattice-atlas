# Feature: Property Checker

## Goal
Evaluate and display whether a selected structure satisfies named properties.

## What It Should Show
- True/false result per property
- Grouping by lattice properties vs residuated-lattice properties

## Why It Matters
This turns the site from a viewer into an actual inspection tool.

## Suggested UI
- Checklist or result table in each pane
- Button to recompute for current structure

## UI Shape
- A result panel under each structure view
- Grouped cards for `property` and `algebra` results
- Auto-refresh whenever the loaded structure changes

## Data Needed
- Property functions from the codebase or new implementations

## Status
Completed for the current milestone.

## Implemented In
- [0bc338a](https://github.com/Tibex88/lattice-atlas/commit/0bc338a) Add inspection, query, and export research tools
