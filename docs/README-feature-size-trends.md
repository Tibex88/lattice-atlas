# Feature: Size Trends

## Goal
Show how counts and proportions change as `n` increases from `1` to `12`.

## What It Should Show
- Count growth by size
- Ratio of `reslat / lat`
- Ratio of linear residuated lattices to all residuated lattices
- Ratio of reduct-supporting lattices to all lattices

## Why It Matters
The paper emphasizes how structure distributions shift with size, especially the decline of linear cases.

## Suggested UI
- Line charts
- Ratio badges
- Hoverable exact values

## UI Shape
- A chart panel with one or more line graphs
- Toggle buttons for raw counts vs percentages
- Hover tooltips for exact values and slope changes across sizes

## Data Needed
- Counts by size for all core datasets
- Optional linear counts

## Status
Not implemented in the current browser UI.
