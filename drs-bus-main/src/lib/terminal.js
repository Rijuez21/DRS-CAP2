// Where the bus terminal is, for the passenger "Getting to the terminal"
// map on Home. Fixed in code on purpose (not admin-editable).
// To move it: open Google Maps, right-click the terminal's entrance, and
// click the "lat, lng" line at the top of the menu to copy it.
export const TERMINAL = {
  name: "D' Rising Sun Bus Terminal",
  address: "Baguio City",
  latitude: 16.42074029377386,
  longitude: 120.59335109898367,
};

// Turn-by-turn directions in the phone's maps app (Google Maps on the web
// or app). The in-app map only shows the route; it doesn't navigate.
export function terminalDirectionsUrl() {
  return `https://www.google.com/maps/dir/?api=1&destination=${TERMINAL.latitude},${TERMINAL.longitude}`;
}
