import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

// TODO: every section below is a structural placeholder — replace the
// TODO paragraphs with the real policy content once requirements are
// specified. Section order/headings follow a standard privacy-policy
// shape and can be reordered or renamed as needed.

const SECTIONS = [
  {
    heading: "Introduction",
    body: "TODO: brief statement of who D' Rising Sun Transport is, what this policy covers, and which parts of the platform it applies to (passenger app, driver app, terminal staff, admin).",
  },
  {
    heading: "Information We Collect",
    body: "TODO: list the categories of data actually collected — e.g. account details (name, email, phone), booking history, payment/reference info, and location data (GPS telemetry from the driver app). Be specific about what's collected from each role.",
  },
  {
    heading: "How We Use Your Information",
    body: "TODO: explain the purposes data is used for — processing bookings, live bus tracking, account authentication, customer support, and any analytics or reporting.",
  },
  {
    heading: "Location Data",
    body: "TODO: specific to this platform — explain that GPS location is collected from the driver's device during an active trip for live tracking purposes, including how it's buffered offline and synced, and how long it's retained.",
  },
  {
    heading: "Data Sharing & Third Parties",
    body: "TODO: state whether data is shared with any third parties (e.g. mapping providers, payment processors) and under what circumstances.",
  },
  {
    heading: "Data Security",
    body: "TODO: describe the safeguards in place to protect user data.",
  },
  {
    heading: "Your Rights",
    body: "TODO: explain what users can request — access, correction, deletion of their data — and how to make that request.",
  },
  {
    heading: "Children's Privacy",
    body: "TODO: state whether the platform is intended for use by minors and how that's handled.",
  },
  {
    heading: "Changes to This Policy",
    body: "TODO: explain how and where updates to this policy will be communicated.",
  },
  {
    heading: "Contact Us",
    body: "TODO: contact details for privacy-related questions or requests.",
  },
];

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-surface text-ink-900">
      <header className="border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center">
          <Link
            to="/"
            className="flex items-center gap-1 text-sm text-ink-600 hover:text-brand-green-600"
          >
            <ChevronLeft className="w-4 h-4" /> Back to home
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="font-display text-3xl font-bold text-brand-forest-900">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-ink-600">
          Last updated: TODO — set a real date once this policy is finalized.
        </p>

        <div className="mt-10 space-y-10">
          {SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="font-display text-lg font-semibold text-brand-forest-900">
                {section.heading}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                {section.body}
              </p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}