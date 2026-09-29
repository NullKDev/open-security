/**
 * /repos — List of tracked repositories.
 */
export const dynamic = "force-dynamic"

interface RepoDTO {
  id: string
  name: string
  localPath: string
  defaultBranch: string
  watchEnabled: boolean
  watchInterval: string
  createdAt: string
}

async function fetchRepos(): Promise<RepoDTO[]> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
    const res = await fetch(`${base}/api/repos`, { cache: "no-store" }) // api/repos
    if (!res.ok) return []
    const body = await res.json()
    return (body.data as RepoDTO[]) ?? []
  } catch {
    return []
  }
}

export default async function ReposPage() {
  const repos = await fetchRepos()

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-fg">Repositories</h1>
          <p className="text-sm text-fg/50">
            Tracked repos for Watch Mode and webhook integration
          </p>
        </div>
      </div>

      {repos.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm text-fg/50">No repositories tracked yet.</p>
          <p className="mt-1 text-xs text-fg/30">
            Add a repo to enable Watch Mode and webhook-triggered diff scans.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {repos.map((repo) => (
            <li key={repo.id} className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium text-fg">{repo.name}</p>
                <p className="mt-0.5 font-mono text-xs text-fg/50">
                  {repo.localPath}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`h-2 w-2 rounded-full ${
                    repo.watchEnabled ? "bg-green-500" : "bg-fg/20"
                  }`}
                  title={repo.watchEnabled ? "Watch enabled" : "Watch disabled"}
                />
                <a
                  href={`/repos/${repo.id}/settings`}
                  className="text-xs text-accent hover:underline"
                >
                  Settings
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
