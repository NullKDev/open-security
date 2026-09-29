# CVE Hunt: Deserialization Vulnerability — {{cveId}}

## Objective
Determine whether the codebase at `{{targetPath}}` is affected by the deserialization vulnerability described in {{cveId}}.

## Advisory Summary
{{summary}}

## Analysis Steps

1. **Find deserialization calls**: Locate `JSON.parse`, `eval`, `vm.runInContext`, pickle loads, Java `ObjectInputStream`, and similar deserialization entry points.
2. **Trace untrusted input**: Determine whether the deserialized data originates from user input, network responses, or other untrusted sources.
3. **Assess validation**: Check if deserialized objects are validated against a strict schema before use.
4. **Review gadget chains**: For Java/Python, assess whether the classpath includes known gadget libraries (Apache Commons Collections, Spring, etc.).

{{pocUrl}}

## Verdict
After analysis, determine: **exposed** | **not-exposed** | **indeterminate**
