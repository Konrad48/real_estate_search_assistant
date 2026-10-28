"use client";

export function ExportButton({ searchId }: { searchId: number }) {
  return (
    <a
      href={`/api/searches/${searchId}/export`}
      className="rounded-md border border-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
    >
      Eksport do Excela
    </a>
  );
}
