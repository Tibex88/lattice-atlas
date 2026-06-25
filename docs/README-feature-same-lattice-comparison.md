# Feature: Same-Lattice Comparison Across Residuated Expansions

## Goal
Compare multiple `reslat` structures that share the same underlying lattice.

## What It Should Show
- Same order matrix and graph
- Different multiplication tables
- Expansion count from `extlat`

## Why It Matters
This is one of the clearest ways to explain what `extlat` and `reslat` mean.

## Suggested UI
- Group `reslat` entries by base lattice
- Multi-select comparison panel
- Diff highlighting in multiplication tables

## UI Shape
- A grouped list keyed by the base lattice
- One fixed lattice graph with multiple expansion panes beside or below it
- Visual highlights on multiplication cells that differ between expansions

## Data Needed
- Way to map `reslat` encodings back to base lattice encodings
- `extlat` counts

## Status
Partially conceptually supported by the compare UI, but not grouped by base lattice yet.
