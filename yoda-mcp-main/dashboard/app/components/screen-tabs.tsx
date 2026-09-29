import Link from "next/link";

/* Header nav: flip between the Care dashboard (/) and the Welfare check (/welfare).
   Client-side links — instant, no full reload. The active screen is highlighted. */
export default function ScreenTabs({ current }: { current: "care" | "welfare" }) {
  const tab = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
      active ? "bg-ink text-white shadow-sm" : "text-muted hover:text-ink"
    }`;
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-line bg-paper p-0.5">
      <Link href="/" className={tab(current === "care")}>
        Care
      </Link>
      <Link href="/welfare" className={tab(current === "welfare")}>
        Welfare
      </Link>
    </div>
  );
}
