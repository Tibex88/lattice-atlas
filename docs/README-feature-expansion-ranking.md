# Feature: extlat Expansion-Count Ranking

## Goal
Rank base lattices by how many residuated-lattice expansions they admit.

## What It Should Show
- Highest-expansion lattices
- Lowest-expansion lattices
- Distribution of expansion counts

## Why It Matters
This directly uses the distinctive `extlat` dataset and shows which lattices are most expandable.

## Suggested UI
- Sortable table
- Histogram of counts
- Click-through into the corresponding lattice

## UI Shape
- A ranked table with sortable columns
- A companion histogram showing how expansion counts are distributed
- Row click opens the base lattice in the compare area

## Data Needed
- `extlat<n>.db` values

## Status
Not implemented.
