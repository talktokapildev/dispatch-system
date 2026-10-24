// Live train times pages: calls to the OrangeRide backend. SERVER ONLY — it sends the secret
// site key (the same FLIGHT_STATUS_SITE_KEY as the flight status pages).

import { API_URL } from "./quote";
import type { TrainBoardData, TrainResult } from "./trainFormat";

async function getJson(path: string): Promise<any | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { "x-site-key": process.env.FLIGHT_STATUS_SITE_KEY ?? "" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.success ? json.data : null;
  } catch {
    return null;
  }
}

/** The station's cached board; null if the backend can't be reached. */
export async function fetchTrainBoard(slug: string): Promise<TrainBoardData | null> {
  return getJson(`/public/train-times/${encodeURIComponent(slug)}/board`);
}

/** One train (live, or the last copy seen in the past 6 hours). */
export async function fetchTrain(slug: string, id: string): Promise<TrainResult> {
  const data = await getJson(`/public/train-times/${encodeURIComponent(slug)}/train/${encodeURIComponent(id)}`);
  return data ?? { status: "ERROR" };
}
