import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Social share image (also used for Twitter): dark background, wordmark, hero headline.
export const alt = "OrangeRide: Gatwick transfers, planned to the minute.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const logo = await readFile(join(process.cwd(), "public/images/logo-wordmark-dark.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;
  // Brand fonts (SIL Open Font License), bundled so the image builds without network access.
  const heading = await readFile(join(process.cwd(), "src/assets/og/familjen-grotesk-latin-700-normal.woff"));
  const body = await readFile(join(process.cwd(), "src/assets/og/figtree-latin-500-normal.woff"));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#2e3238",
          padding: "72px 80px",
          fontFamily: "Figtree",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} width={340} height={80} alt="" />
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              fontFamily: "Familjen Grotesk",
              fontSize: 88,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.04em",
              color: "#ffffff",
            }}
          >
            Gatwick transfers,&nbsp;<span style={{ color: "#f59e0b" }}>planned to the minute.</span>
          </div>
          <div style={{ display: "flex", fontSize: 32, color: "#d1d5db" }}>
            Pre-booked, fixed-fare private hire from Crawley & Horley · TfL 11786
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Familjen Grotesk", data: heading, weight: 700, style: "normal" },
        { name: "Figtree", data: body, weight: 500, style: "normal" },
      ],
    },
  );
}
