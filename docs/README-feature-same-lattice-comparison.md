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

## Data Needed
- Way to map `reslat` encodings back to base lattice encodings
- `extlat` counts

## Status
Partially conceptually supported by the compare UI, but not grouped by base lattice yet.
