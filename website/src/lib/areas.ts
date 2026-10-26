// Local area pages: /gatwick-taxi/<slug> ("Horsham to Gatwick taxi" etc.).
// Chosen from CAA passenger survey + Census 2021 (Oct 2026): car-owning, leisure-travelling towns
// near Gatwick where the usual alternative is a lift, the car park or a drive to the station.
// Keep facts here plain and checkable: no fares (the calculator prices live), no train times.

export type Area = {
  slug: string;
  /** Town name as used in headings ("Horsham"). */
  town: string;
  /** Wider area for copy ("Horsham district"). */
  district: string;
  /** Short line under the heading. */
  intro: string;
  /** Typical drive to Gatwick, as plain words. */
  drive: string;
  /** The station people would otherwise use. */
  station: string;
  /** Villages and nearby towns we serve from this page (all within our service area). */
  places: string[];
  /** Search description. */
  description: string;
};

export const AREAS: Area[] = [
  {
    slug: "horsham",
    town: "Horsham",
    district: "Horsham district",
    intro:
      "Fixed-fare private hire between Horsham and Gatwick, door to door, with pickups timed to your landing.",
    drive: "usually 20 to 30 minutes, depending on traffic",
    station: "Horsham station",
    places: [
      "Southwater",
      "Billingshurst",
      "Broadbridge Heath",
      "Warnham",
      "Rusper",
      "Faygate",
      "Mannings Heath",
      "Lower Beeding",
      "Slinfold",
      "Rudgwick",
      "Cowfold",
      "Partridge Green",
      "Henfield",
      "Storrington",
      "Steyning",
    ],
    description:
      "Horsham to Gatwick taxi: fixed fares, pre-booked, door to door. We track your flight and time your pickup to your landing. Southwater, Billingshurst, Henfield and nearby villages too.",
  },
  {
    slug: "haywards-heath",
    town: "Haywards Heath",
    district: "Mid Sussex",
    intro:
      "Fixed-fare private hire between Haywards Heath, Mid Sussex and Gatwick, door to door, with pickups timed to your landing.",
    drive: "usually 20 to 30 minutes, depending on traffic",
    station: "Haywards Heath station",
    places: [
      "Cuckfield",
      "Lindfield",
      "Burgess Hill",
      "Hassocks",
      "Hurstpierpoint",
      "Ardingly",
      "Balcombe",
      "Handcross",
      "Bolney",
      "Ansty",
      "Scaynes Hill",
      "Wivelsfield",
      "East Grinstead",
    ],
    description:
      "Haywards Heath and Mid Sussex to Gatwick taxi: fixed fares, pre-booked, door to door. We track your flight and time your pickup to your landing. Cuckfield, Lindfield, Burgess Hill and more.",
  },
];

export const areaPath = (slug: string) => `/gatwick-taxi/${slug}`;

export function findArea(slug: string): Area | undefined {
  return AREAS.find((a) => a.slug === slug);
}
