# Feature: Shortlist Compare

## Goal
Compare a small saved set of candidate blueprints before choosing which shapes to keep.

## What It Should Show
- A pinned shortlist drawn from saved blueprints
- Shared true-property core across the shortlist
- Per-blueprint dimensions and distinguishing properties

## Why It Matters
Blueprint curation is less useful if candidates can only be opened one at a time. A shortlist creates a deliberate compare workflow.

## Suggested UI
- Shortlist toggle on saved blueprints
- Compare panel with multiple candidate cards
- Quick actions to load shortlisted items into the primary or secondary panes

## UI Shape
- A `Shortlist` action on each saved blueprint row
- A compare panel that shows up to a few shortlisted candidates at once
- Shared-property chips plus unique-property chips for each candidate

## Data Needed
- Saved blueprint metadata
- Decoded entry details for shortlisted items

## Status
Completed for the current milestone.
