import type { ReactNode } from "react";
import { TFL_LICENCE } from "@/lib/site";
import { BriefcaseIcon, CardIcon, PersonIcon, ShieldIcon } from "../Icons";

type Item = { icon: ReactNode; title: string; text: string; light?: boolean };

const ITEMS: Item[] = [
  { icon: <ShieldIcon />, title: "TfL licensed operator", text: `Licence ${TFL_LICENCE}` },
  { icon: <PersonIcon />, title: "Valid PCO licence", text: "DBS-checked drivers" },
  { icon: <BriefcaseIcon />, title: "Fully insured", text: "Every journey" },
  {
    icon: <CardIcon />,
    title: "Pay your way",
    text: "Card, Apple Pay, Google Pay, cash",
    light: true,
  },
];

export default function TrustRow() {
  return (
    <section aria-label="Why you can trust us" className="mx-auto max-w-site px-6 pb-24">
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-[14px] p-0">
        {ITEMS.map((item) => (
          <li
            key={item.title}
            className="flex items-center gap-[14px] rounded-[22px] border border-line bg-white p-5"
          >
            <span
              className={`grid h-[46px] w-[46px] flex-none place-items-center rounded-[14px] ${
                item.light ? "bg-[#fff3e3]" : "bg-ink"
              }`}
            >
              {item.icon}
            </span>
            <span className="flex flex-col leading-[1.35]">
              <strong className="text-ink">{item.title}</strong>
              <span className="text-[14px]">{item.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
