// The backend logs raw action codes (create, update, delete, status_change,
// walk_in_sale, counter_payment, verify, reject, pin, unpin, suspend, ...)
// against entity types (bus, driver, route, trip, staff, booking, payment,
// passenger, ...). Gluing "d" onto the code used to produce "verifyd",
// "pind", "walk_in_saled" — so each code gets its own phrase here, with a
// readable fallback for any code added to the backend later. Used by the
// admin Dashboard's recent-activity feed and the Activity Log page.
const ENTITY_LABEL = {
  bus: "bus",
  driver: "driver",
  route: "route",
  trip: "trip",
  staff: "staff account",
  booking: "booking",
  payment: "payment",
  payment_qr: "payment QR code",
  passenger: "passenger",
};

export function entityLabel(entityType) {
  return ENTITY_LABEL[entityType] ?? (entityType ?? "record").replaceAll("_", " ");
}

export function describeActivity({ action, entity_type: entityType, entity_id: entityId }) {
  const entity = entityLabel(entityType);
  const ref = entityId ? ` #${entityId}` : "";
  switch (action) {
    case "create": return `added ${entity}${ref}`;
    case "update": return `updated ${entity}${ref}`;
    case "delete": return `deleted ${entity}${ref}`;
    case "status_change": return `changed the status of ${entity}${ref}`;
    case "walk_in_sale": return `sold a walk-in ticket (${entity}${ref})`;
    case "counter_payment": return `took a counter payment for ${entity}${ref}`;
    case "verify": return `verified ${entity}${ref}`;
    case "reject": return `rejected ${entity}${ref}`;
    case "pin": return `pinned the stop on ${entity}${ref}`;
    case "unpin": return `removed the pinned stop from ${entity}${ref}`;
    case "suspend": return `suspended ${entity}${ref}`;
    case "unsuspend": return `lifted the suspension on ${entity}${ref}`;
    case "verify_email": return `confirmed the email of ${entity}${ref}`;
    default: return `${String(action ?? "changed").replaceAll("_", " ")} ${entity}${ref}`;
  }
}
