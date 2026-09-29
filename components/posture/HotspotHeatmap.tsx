"use client";

interface HeatmapCell {
  filePath: string;
  authorEmail: string;
  distinctDedupKeys: number;
  repeatOffender: boolean;
}

interface HotspotHeatmapProps {
  cells: HeatmapCell[];
  title?: string;
}

/**
 * Hotspot heatmap — renders a table of file × author cells showing
 * vulnerability density. Cells with repeatOffender=true (count >= 3)
 * are highlighted with an accent color.
 */
export function HotspotHeatmap({ cells, title }: HotspotHeatmapProps) {
  if (cells.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-fg/40">
        No hotspots detected
      </div>
    );
  }

  // Derive unique files and authors for axis labels
  const files = Array.from(new Set(cells.map((c) => c.filePath)));
  const authors = Array.from(new Set(cells.map((c) => c.authorEmail)));

  // Build lookup for fast cell access
  const lookup = new Map<string, HeatmapCell>();
  for (const cell of cells) {
    lookup.set(`${cell.filePath}::${cell.authorEmail}`, cell);
  }

  function shortPath(p: string): string {
    const parts = p.split("/").filter(Boolean);
    return parts.length <= 2 ? p : "…/" + parts.slice(-2).join("/");
  }

  function shortEmail(e: string): string {
    return e.split("@")[0];
  }

  /** Map count → intensity class */
  function intensityClass(count: number, repeatOffender: boolean): string {
    if (repeatOffender) {
      // Accent (orange-ish danger) for repeat offenders
      if (count >= 5) return "bg-red-500/80 text-white";
      return "bg-orange-400/70 text-white";
    }
    if (count >= 3) return "bg-accent/40 text-fg";
    if (count >= 2) return "bg-accent/20 text-fg";
    if (count >= 1) return "bg-accent/10 text-fg";
    return "bg-transparent text-fg/20";
  }

  return (
    <div aria-label="hotspot heatmap">
      {title && (
        <h3 className="text-sm font-medium text-fg/70 mb-2">{title}</h3>
      )}
      <div className="overflow-x-auto">
        <table
          className="border-collapse text-xs"
          role="grid"
        >
          <thead>
            <tr>
              {/* Top-left empty corner */}
              <th className="p-1 text-left font-normal text-fg/40 min-w-[120px]">
                File
              </th>
              {authors.map((author) => (
                <th
                  key={author}
                  className="p-1 font-normal text-fg/40 text-center whitespace-nowrap min-w-[60px]"
                  title={author}
                >
                  {shortEmail(author)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file}>
                <td
                  className="p-1 font-mono text-fg/60 whitespace-nowrap"
                  title={file}
                >
                  {shortPath(file)}
                </td>
                {authors.map((author) => {
                  const cell = lookup.get(`${file}::${author}`);
                  const count = cell?.distinctDedupKeys ?? 0;
                  const repeat = cell?.repeatOffender ?? false;
                  if (count === 0) {
                    return (
                      <td
                        key={author}
                        className="p-1 text-center text-fg/10"
                        data-repeat-offender="false"
                      >
                        ·
                      </td>
                    );
                  }
                  return (
                    <td
                      key={author}
                      className={`p-1 text-center rounded font-semibold ${intensityClass(count, repeat)}`}
                      data-repeat-offender={String(repeat)}
                      title={`${file} × ${author}: ${count} finding${count !== 1 ? "s" : ""}${repeat ? " (repeat offender)" : ""}`}
                    >
                      {count}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
