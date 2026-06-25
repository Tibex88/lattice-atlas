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
- Tabbed or stacked tables under the graph
- Separate tabs for multiplication, residuum, and optional negation
- A compact toggle to hide advanced operation views when not needed

## Data Needed
- Decoded `ResiduatedLattice`

## Status
Not implemented.
