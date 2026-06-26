# Feature: Derived Operation Display

## Goal
Show derived operations, especially the residuum `→`, not just the multiplication table.

## What It Should Show
- Full residuum table
- Optional negation column derived from `a → 0`

## Why It Matters
A residuated lattice is defined by the interaction between order, multiplication, and residuation.

## Suggested UI
- Additional table beside multiplication
- Toggle to show or hide derived operations

## UI Shape
- A collapsible derived-operations section under the main tables
- Residuum and negation shown together when the entry is a `reslat`
- Hidden entirely for non-residuated datasets

## Data Needed
- Decoded `ResiduatedLattice`

## Status
Completed for the current milestone.

## Implemented In
- [0bc338a](https://github.com/Tibex88/lattice-atlas/commit/0bc338a) Add inspection, query, and export research tools
