# Scan Schema Specification

## Purpose

Defines the schema for scan modes and the database `project_map` column.

## Requirements

### Requirement: ScanMode Enum

`ScanModeSchema` MUST accept exactly `'quick' | 'standard' | 'intermediate' | 'paranoid'`. The default MUST remain `'standard'`. `'deep'` MUST NOT be accepted by the schema.

#### Scenario: Valid new mode accepted

- GIVEN a CreateScan request with `scanMode: 'paranoid'`
- WHEN `CreateScanSchema.parse` is called
- THEN validation passes

#### Scenario: Legacy deep mode rejected

- GIVEN a CreateScan request with `scanMode: 'deep'`
- WHEN `CreateScanSchema.parse` is called
- THEN validation throws a ZodError

#### Scenario: Default mode unchanged

- GIVEN a CreateScan request with no `scanMode` field
- WHEN `CreateScanSchema.parse` is called
- THEN the parsed value has `scanMode: 'standard'`

### Requirement: project_map Column

The `scans` table MUST have a `project_map TEXT` column, nullable, defaulting to NULL. Existing rows without a `project_map` value MUST be valid.

#### Scenario: Column present after migration

- GIVEN the migration has been applied
- WHEN a new scan row is inserted without `project_map`
- THEN the row is accepted and `project_map` is NULL

### Requirement: deep → paranoid Migration

Any existing `scans` row with `scan_mode = 'deep'` MUST be updated to `scan_mode = 'paranoid'` by the migration. The migration MUST be idempotent (re-running it on already-migrated data produces no error).

#### Scenario: Migration rewrites deep rows

- GIVEN one or more scan rows with `scan_mode = 'deep'` before migration
- WHEN the migration runs
- THEN all such rows have `scan_mode = 'paranoid'` after migration
