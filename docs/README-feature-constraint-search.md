# Feature: Constraint-Based Search

## Goal
Let users search by structure constraints rather than only by index.

## What It Should Show
- Search by size
- Search by width or height
- Search by property set
- Search by expansion count range

## Why It Matters
A research-facing browser needs targeted discovery, not only pagination.

## Suggested UI
- Filter form
- Result table
- Saveable query state in URL

## UI Shape
- A structured sidebar form with width/height sliders, optional count range, and property checkboxes
- A paginated result list with direct load actions for primary and secondary panes
- A shareable URL plus visible constraint summary that preserve the current query

## Data Needed
- Indexed metadata for structures

## Status
Completed for the current milestone.

## Implemented In
- [0bc338a](https://github.com/Tibex88/lattice-atlas/commit/0bc338a) Add inspection, query, and export research tools
