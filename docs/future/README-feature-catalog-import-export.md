# Feature: Generic Catalog Import and Export

## Goal
Let the dashboard load and emit JSON content catalogs without turning this repo into the game engine.

## What It Should Show
- Imported primitive or capability labels
- Exportable annotated blueprints
- Validation results for required catalog fields

## Why It Matters
This is the bridge between algebraic blueprint selection and later content authoring, while keeping the repo focused on analysis.

## Suggested UI
- Import dialog
- Mapping preview
- Export buttons for annotated results

## UI Shape
- A lightweight import or export toolbar
- Validation results shown before applying a catalog
- Download actions for the annotated blueprint package

## Data Needed
- JSON schema for imported labels or catalogs
- Export format for annotated blueprint selections

## Status
Not implemented.
