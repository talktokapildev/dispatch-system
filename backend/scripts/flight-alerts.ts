// Manage AeroDataBox Flight Alert credits and subscriptions by hand.
//
//   node --env-file=.env -r ts-node/register scripts/flight-alerts.ts balance
//   node --env-file=.env -r ts-node/register scripts/flight-alerts.ts refill 200
//   node --env-file=.env -r ts-node/register scripts/flight-alerts.ts list
//   node --env-file=.env -r ts-node/register scripts/flight-alerts.ts delete <id>
//   node --env-file=.env -r ts-node/register scripts/flight-alerts.ts delete-all
//
// Credits come out of the monthly API units (1 credit = 1 unit).
import {
  getBalance,
  refillBalance,
  listSubscriptionIds,
  deleteSubscription,
} from "../src/services/flightAlerts.service";

const MAX_REFILL = 500; // guard against typos (e.g. 2000 instead of 200)
const log = { warn: (m: string) => console.log(m) };

async function main() {
  if (!process.env.AERODATABOX_API_KEY)
    throw new Error("AERODATABOX_API_KEY missing");
  const [cmd, arg] = process.argv.slice(2);

  switch (cmd) {
    case "balance": {
      const r = await getBalance();
      console.log(
        `HTTP ${r.status}`,
        r.data === "" ? "(empty: no balance yet)" : JSON.stringify(r.data)
      );
      break;
    }
    case "refill": {
      const credits = Number(arg);
      if (!Number.isInteger(credits) || credits < 1 || credits > MAX_REFILL)
        throw new Error(`refill needs a whole number 1–${MAX_REFILL}`);
      const r = await refillBalance(credits);
      console.log(`HTTP ${r.status}`, JSON.stringify(r.data));
      const b = await getBalance();
      console.log(`Balance now: HTTP ${b.status}`, JSON.stringify(b.data));
      break;
    }
    case "list": {
      const ids = await listSubscriptionIds();
      console.log(
        ids === null
          ? "Could not read the list"
          : ids.length
          ? ids.join("\n")
          : "(none)"
      );
      break;
    }
    case "delete": {
      if (!arg) throw new Error("delete needs a subscription id");
      await deleteSubscription(arg, log);
      break;
    }
    case "delete-all": {
      const ids = (await listSubscriptionIds()) ?? [];
      for (const id of ids) await deleteSubscription(id, log);
      console.log(`Deleted ${ids.length} subscription(s)`);
      break;
    }
    default:
      console.log(
        "Commands: balance | refill <credits> | list | delete <id> | delete-all"
      );
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
