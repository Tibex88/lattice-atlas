# Feature: Width and Height Distribution

## Goal
Expose how widths and heights are distributed across structures.

## What It Should Show
- Width distribution
- Height distribution
- Width/height joint distribution
- Size-specific views, especially for `n = 12`

## Why It Matters
The paper treats width and height as important structural characteristics and uses them to compare families of lattices.

## Suggested UI
- Heatmap for width vs. height
- Bar charts for marginals
- Filter by dataset and size

## UI Shape
- A central heatmap grid for width/height combinations
- Small side bar charts showing width-only and height-only totals
- Clickable cells that open matching structures in the browser panes

## Data Needed
- Per-structure width
- Per-structure height
- Aggregated counts

## Status
Not implemented.
