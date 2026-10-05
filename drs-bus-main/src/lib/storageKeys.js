// sessionStorage keys shared between pages.

// The last successful Book Ahead reservation, so BookingConfirmed still
// shows the booking codes after a refresh (router state alone is lost).
export const LAST_BOOKING_KEY = "drs_last_booking";


// flag_id of an open Flag a Bus request whose pickup pin the passenger
// placed by hand, so FlagBus doesn't move that pin to their GPS reading
// after a page refresh.
export const MANUAL_PIN_FLAG_KEY = "drs_manual_pin_flag";