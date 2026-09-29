# CVE Hunt: Path Traversal — {{cveId}}

## Objective
Determine whether the codebase at `{{targetPath}}` is affected by the path traversal vulnerability described in {{cveId}}.

## Advisory Summary
{{summary}}

## Analysis Steps

1. **Identify file operations**: Locate all `fs.readFile`, `fs.writeFile`, `path.join`, `path.resolve` and similar operations that incorporate user input.
2. **Check path normalization**: Verify that file paths are normalized and validated before use — look for `path.normalize` + allowlist checks.
3. **Assess canonicalization**: Confirm that `..` sequences are properly handled and cannot escape intended directories.
4. **Review directory restrictions**: Check for hardcoded base directory guards and whether they are applied consistently.

{{pocUrl}}

## Verdict
After analysis, determine: **exposed** | **not-exposed** | **indeterminate**
