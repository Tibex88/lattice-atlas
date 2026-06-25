# Feature: Export to CSV and JSON

## Goal
Let users take data and results out of the browser for analysis.

## What It Should Show
- Export current filtered list
- Export current structure
- Export aggregate tables

## Why It Matters
This makes the site useful for follow-up research and reproducibility.

## Suggested UI
- Export buttons near tables and search results
- Format selector

## UI Shape
- Small export controls attached to result lists, aggregate tables, the co-occurrence matrix, and both viewer panes
- Dedicated CSV or JSON buttons instead of a dropdown
- Direct browser download generation from the visible data views

## Data Needed
- Serialization of visible data

## Status
Completed for the current milestone.

## Implemented In
- [0bc338a](https://github.com/Tibex88/lattice-atlas/commit/0bc338a) Add inspection, query, and export research tools
