/**
 * lib/templates/interpolate.ts
 *
 * Safe {{var}} string substitution engine.
 * Used by HuntContext prompt builder and Playbook prompt rendering.
 *
 * No eval, no dynamic code execution — purely regex-based replacement.
 */

/**
 * Replaces `{{varName}}` placeholders in `template` with values from `vars`.
 *
 * - Only word characters (`\w+`) are matched as placeholder names.
 * - Unknown placeholders are left as-is (not removed, not errored).
 * - The same placeholder can appear multiple times and is replaced each time.
 *
 * @param template - The template string containing `{{var}}` placeholders.
 * @param vars - A map of variable names to their string values.
 * @returns The interpolated string.
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : `{{${key}}}`
  })
}
