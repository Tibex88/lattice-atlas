# Feature: Count Dashboards

## Goal
Show the exact counts of `lat`, `reslat`, and `extlat` structures, matching the paper's enumeration focus.

## What It Should Show
- Total lattices by size `n`
- Total residuated lattices by size `n`
- Total residuated-lattice reducts by size `n`
- Total linear residuated lattices by size `n` when available

## Why It Matters
This is the most direct way to expose the paper's main computational result: complete enumeration up to size 12.

## Suggested UI
- Summary cards
- Small trend table for sizes `1..12`
- Optional chart for total counts

## Data Needed
- `lat<n>.db`
- `reslat<n>.db`
- `extlat<n>.db`
- Optional precomputed linear counts

## Status
Partially supported by the current summary popup, but not complete yet.
