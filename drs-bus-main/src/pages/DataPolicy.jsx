import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

// Written for the Data Privacy Act of 2012 (Republic Act No. 10173). Set
// these two before going live, and update LAST_UPDATED whenever the text
// changes. Retention periods below are promises: if the app's behaviour
// changes, change this page too.
const PRIVACY_EMAIL = "privacy@example.com"; // TODO: the Data Protection Officer's real address
const LAST_UPDATED = "October 27, 2026";

// Each section: a heading, an opening paragraph, and optional bullet points.
const SECTIONS = [
  {
    heading: "Introduction",
    body: "D' Rising Sun Transport (\"we\", \"us\") runs this bus booking and tracking platform for the Baguio–Bontoc line. This policy explains what personal information we collect, why, how long we keep it, who can see it, and the rights you have under the Data Privacy Act of 2012 (Republic Act No. 10173) and its Implementing Rules. It covers the passenger app and website, the driver app, and the terminal staff, bus owner and administrator tools. By creating an account and ticking the consent box at sign-up, you agree to the processing described here.",
  },
  {
    heading: "Information We Collect",
    body: "We collect only what we need to run the service:",
    items: [
      "Account details: your full name, email address, mobile number and password. Your password is stored only as a one-way hash; nobody at D' Rising Sun can read it.",
      "Bookings and trips: the trips you book, seat numbers, passenger names on each ticket, booking status, and the time you accepted this policy.",
      "Payment information: for online payments you transfer the fare through your own e-wallet or bank app, then send us the reference number, amount, date and a screenshot of the receipt so staff can verify it. We do not collect or store card numbers, e-wallet PINs or bank passwords.",
      "Fare discount documents: if you apply for a student, PWD or senior citizen discount, a photo of your ID and (optionally) the ID number, plus the result of the staff review.",
      "Location data: see \"Location Data\" below.",
      "Driver, staff and owner accounts: name, contact details and the employment details an administrator records (for example employee number, licence details, address and emergency contact).",
      "Technical data: your IP address and basic request logs, used for security (such as limiting repeated failed logins), and the sign-in details your browser keeps so you stay logged in.",
    ],
  },
  {
    heading: "How We Use Your Information",
    body: "We use your information only for these purposes:",
    items: [
      "To create and secure your account and let you sign in.",
      "To reserve seats, issue tickets, and run the passenger manifest that drivers and terminal staff use at boarding.",
      "To verify payments and discount IDs, and apply the correct fare.",
      "To show live bus locations and estimated arrivals, and to let a driver find you when you flag a bus.",
      "To contact you about your trips, such as schedule changes, cancellations or problems with a payment.",
      "To prepare reports for managing routes, schedules and the fleet. These reports use totals, not individual passenger details, wherever possible.",
      "To comply with legal obligations and respond to lawful requests from authorities.",
    ],
  },
  {
    heading: "Location Data",
    body: "During an active trip, the bus's location is collected from the GPS tracker fitted to the bus or, as a backup, from the driver's phone while the driver app is open. If the phone loses signal, points are kept on the device and sent once it reconnects. This is the bus's location, not a passenger's. Passengers' devices are not tracked. When you use \"Flag a Bus\", we receive the pickup point you choose (map position or landmark) and share it with the driver of that bus so they can stop for you. Bus location history is used for live tracking, trip records and service planning.",
  },
  {
    heading: "Data Sharing & Third Parties",
    body: "We do not sell your personal information or share it for advertising. It is shared only as follows:",
    items: [
      "Within D' Rising Sun: drivers see the names and seats on their trip and any flag-down pickup points; terminal staff see bookings, payment submissions and discount applications; administrators manage accounts. Bus owners see information about their own buses and trips.",
      "Service providers that host the platform (cloud servers and database). Some of these may store data outside the Philippines; we use providers with appropriate security safeguards, as the Data Privacy Act requires.",
      "Maps: the live map loads map images from OpenStreetMap, and \"Directions\" links open Google Maps. These services receive your IP address and the map area you view, under their own privacy policies.",
      "Authorities, when required by law, court order, or to protect the safety of passengers and crew.",
    ],
  },
  {
    heading: "Data Retention",
    body: "We keep personal information only as long as it is needed for the purposes above:",
    items: [
      "Account details: while your account is open. After you ask us to close it, we delete or anonymise your account within 30 days, except records we must keep by law.",
      "Bookings and payment records: kept for as long as the law requires for accounting and tax purposes, then deleted or anonymised.",
      "Discount ID photos: kept while your discount is active and for up to one year after it expires or is rejected, so a review can be checked if questioned.",
      "Bus location history: kept for up to one year for trip records and service planning, then deleted or reduced to totals that do not identify anyone.",
    ],
  },
  {
    heading: "Data Security",
    body: "We use organisational, physical and technical measures to protect your information, including: encrypted (HTTPS) connections; passwords stored as salted hashes; role-based access, so each user sees only what their job needs; limits on repeated failed logins and sign-ups; checks on uploaded images; and an audit log of administrator actions. No system is completely secure. If a breach puts your information at real risk, we will notify you and the National Privacy Commission as the law requires.",
  },
  {
    heading: "Your Rights",
    body: "Under the Data Privacy Act you have the right to:",
    items: [
      "Be informed about how your personal information is processed (this policy).",
      "Access the personal information we hold about you and get a copy of it.",
      "Correct information that is inaccurate or incomplete.",
      "Have your information deleted or blocked when it is no longer needed, was collected unlawfully, or you withdraw consent, subject to records we must keep by law.",
      "Object to processing and withdraw your consent. Some features, such as booking, cannot work without the information they need.",
      "Data portability: receive your information in a commonly used electronic format.",
      "File a complaint with the National Privacy Commission (privacy.gov.ph) and claim damages if your rights are violated.",
    ],
    after: "To use any of these rights, email us from the address on your account (see \"Contact Us\"). We may ask you to confirm your identity first, and we will reply within 30 days.",
  },
  {
    heading: "Children's Privacy",
    body: "The service is meant for the general travelling public. Passengers under 18 should create an account and apply for a student discount only with the knowledge and consent of a parent or guardian. If we learn that we hold a minor's information without that consent, we will delete it on request from the parent or guardian.",
  },
  {
    heading: "Changes to This Policy",
    body: "We may update this policy when the service or the law changes. The date at the top of this page shows the latest version. For significant changes, we will let account holders know by email or in the app before the change takes effect.",
  },
  {
    heading: "Contact Us",
    body: `For privacy questions, requests or complaints, contact our Data Protection Officer at ${PRIVACY_EMAIL}. You can also raise concerns with the National Privacy Commission at privacy.gov.ph.`,
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
          Last updated: {LAST_UPDATED}
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
              {section.items && (
                <ul className="mt-2 list-disc pl-5 space-y-1.5 text-sm leading-relaxed text-ink-600">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {section.after && (
                <p className="mt-2 text-sm leading-relaxed text-ink-600">
                  {section.after}
                </p>
              )}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
