// Pure helpers for the admin Documents list.
import { DOC_LABELS } from "./documentRules";

const TYPE_ORDER = Object.keys(DOC_LABELS);

type Row = {
  type: string;
  createdAt: Date | string;
  owner: { kind: string; driverName: string | null; licensePlate: string | null };
};

/**
 * Group rows by driver: each driver's own documents, then their car's; cars with no
 * driver last (by reg). Within an owner: document type order, then newest first.
 */
export function groupByOwner<T extends Row>(rows: T[]): T[] {
  const key = (r: T): (string | number)[] => [
    r.owner.driverName ? 0 : 1,
    (r.owner.driverName ?? "").toLowerCase(),
    r.owner.kind === "driver" ? 0 : 1,
    r.owner.licensePlate ?? "",
  ];
  const typeIdx = (t: string) => {
    const i = TYPE_ORDER.indexOf(t);
    return i < 0 ? TYPE_ORDER.length : i;
  };
  return [...rows].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    const d = typeIdx(a.type) - typeIdx(b.type);
    if (d) return d;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}
