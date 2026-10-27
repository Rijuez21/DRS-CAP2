import { useLocation } from "react-router-dom";
import { BadgePercent, IdCard, ShieldCheck, CalendarClock } from "lucide-react";
import PageHeader from "../../components/passenger/PageHeader";
import DiscountCard from "../../components/passenger/DiscountCard";
import { DISCOUNT_PERCENT, ID_HINTS, CATEGORY_LABELS } from "../../lib/discounts";

const STEPS = [
  { icon: IdCard, text: "Send a clear photo of your Student, PWD or Senior Citizen ID." },
  { icon: ShieldCheck, text: "Terminal staff check it — you'll get a notification when it's done." },
  { icon: BadgePercent, text: `Once verified, your own seat is ${DISCOUNT_PERCENT}% off whenever you book online.` },
  { icon: CalendarClock, text: "Student discounts last one year, then you renew with your new ID. PWD and senior discounts don't expire." },
];

// Profile menu → Fare Discount: apply for (or renew, or re-send) the
// student / PWD / senior discount any time, not only at sign-up.
export default function FareDiscount() {
  const location = useLocation();

  return (
    <div className="page-enter max-w-md mx-auto px-4 py-6 lg:py-10 space-y-5">
      <PageHeader
        back={{ to: "/passenger/profile", label: "Profile" }}
        icon={BadgePercent}
        title="Fare Discount"
        subtitle={`${DISCOUNT_PERCENT}% off for students, PWDs and senior citizens`}
      />

      <DiscountCard notice={location.state?.discountNotice ?? ""} />

      <section className="card p-4 space-y-3" aria-label="How it works">
        <h2 className="text-sm font-semibold">How it works</h2>
        <ol className="space-y-2.5">
          {STEPS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex gap-3 text-xs text-ink-600">
              <span className="w-7 h-7 shrink-0 rounded-lg bg-brand-green-500/12 text-brand-green-600 flex items-center justify-center">
                <Icon className="w-3.5 h-3.5" />
              </span>
              <span className="pt-1.5">{text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card p-4 space-y-2" aria-label="Accepted IDs">
        <h2 className="text-sm font-semibold">Accepted IDs</h2>
        <dl className="space-y-1.5 text-xs">
          {Object.entries(ID_HINTS).map(([type, hint]) => (
            <div key={type}>
              <dt className="font-semibold text-ink-900">{CATEGORY_LABELS[type]}</dt>
              <dd className="text-ink-600">{hint}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-ink-600 pt-1">Bring the same ID when you board — staff may ask to see it.</p>
      </section>
    </div>
  );
}
