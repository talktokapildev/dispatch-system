// node -r ts-node/register scripts/test-document-list.ts
import { groupByOwner } from "../src/services/documentListRules";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}`, ok ? "" : d ?? "");
};
const row = (id: string, kind: string, driverName: string | null, plate: string | null, type: string, day: number) => ({
  id, type, createdAt: new Date(2026, 9, day),
  owner: { kind, driverName, licensePlate: plate },
});
const rows = [
  row("car-unassigned", "vehicle", null, "AB12CDE", "MOT_CERTIFICATE", 20),
  row("nasir-car-mot", "vehicle", "Nasir Abbas Kazmi", "LM71GVW", "MOT_CERTIFICATE", 20),
  row("waqas-pco", "driver", "Waqas Hassan", null, "PCO_LICENSE", 22),
  row("nasir-dbs", "driver", "Nasir Abbas Kazmi", null, "DBS_CHECK", 21),
  row("nasir-pco", "driver", "Nasir Abbas Kazmi", null, "PCO_LICENSE", 20),
  row("kapil-dbs", "driver", "Kapil Dev", null, "DBS_CHECK", 18),
  row("nasir-pco-new", "driver", "Nasir Abbas Kazmi", null, "PCO_LICENSE", 25),
];
const out = groupByOwner(rows).map((r) => r.id);
check("drivers A-Z, own docs then car, unassigned car last", JSON.stringify(out) === JSON.stringify([
  "kapil-dbs", "nasir-pco-new", "nasir-pco", "nasir-dbs", "nasir-car-mot", "waqas-pco", "car-unassigned",
]), out);
check("does not change the input", rows[0].id === "car-unassigned");
check("empty list", groupByOwner([]).length === 0);
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
