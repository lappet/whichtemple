export type Temple = {
  qid: string;
  name: string;
  state: string | null;
  lat: number | null;
  lon: number | null;
  deity: string | null;
  style: string | null;
  inception: string | null;
  heritage: string | null;
  commissionedBy: string | null;
  foundedBy: string | null;
  image: string;
  imageAuthor: string | null;
  imageLicense: string | null;
  wikipedia: string | null;
};

export async function loadTemples(): Promise<Temple[]> {
  const res = await fetch("/temples.json");
  if (!res.ok) throw new Error(`Could not load temple data (${res.status})`);
  return res.json();
}

// Inception values are ISO timestamps, sometimes with pre-1000 or BCE years,
// e.g. "0732-01-01T00:00:00Z".
export function formatFounded(iso: string | null): string | null {
  if (!iso) return null;
  const m = iso.match(/^(-?)0*(\d+)/);
  if (!m) return null;
  const year = m[2];
  if (m[1] === "-") return `${year} BCE`;
  return Number(year) < 1000 ? `${year} CE` : year;
}

export function randomIndex(count: number, exclude?: number): number {
  if (count <= 1) return 0;
  let i = exclude;
  while (i === exclude) i = Math.floor(Math.random() * count);
  return i!;
}
