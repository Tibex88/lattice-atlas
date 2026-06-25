# Feature: Property Co-Occurrence Matrix

## Goal
Show which properties tend to occur together.

## What It Should Show
- Pairwise co-occurrence counts
- Optional normalized co-occurrence ratios

## Why It Matters
The paper discusses dependencies and rare combinations of properties.

## Suggested UI
- Heatmap
- Click a cell to inspect matching structures

## UI Shape
- A square count matrix with numbered headers and a legend
- Color intensity representing co-occurrence count
- Clicking a cell applies the paired property filters to the current result list

## Data Needed
- Property evaluations across a dataset

## Status
Completed for the current milestone.

## Implemented In
- [0bc338a](https://github.com/Tibex88/lattice-atlas/commit/0bc338a) Add inspection, query, and export research tools
