# Feature: Behavior-to-Node Mapping

## Goal
Assign provisional game-facing meanings to nodes in a chosen blueprint while keeping this repo separate from the full engine.

## What It Should Show
- Node labels such as `Fire`, `Dash`, or `Block`
- Mapping completeness
- Warnings when a mapping conflicts with the intended order reading

## Why It Matters
This is the point where a pure shape becomes a candidate game design, but it also starts to cross into engine-adjacent territory.

## Suggested UI
- Node annotation editor
- Mapping checklist
- Order-consistency warnings

## UI Shape
- A node-detail panel attached to the structure view
- Editable labels and notes per node
- Validation messages explaining whether the assigned behaviors still fit the blueprint logic

## Data Needed
- Blueprint node identities
- Annotation storage
- Rules for checking mapping consistency against the lattice order

## Status
Future scope.
