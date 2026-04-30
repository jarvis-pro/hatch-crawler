export function JsonViewer({ data }: { data: unknown }) {
  return (
    <pre className="overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
