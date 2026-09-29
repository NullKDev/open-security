import ScanProgress from "./ScanProgress";

export default async function ScanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ScanProgress scanId={id} />;
}
