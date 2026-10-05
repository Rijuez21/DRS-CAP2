import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Makes Leaflet's default pin marker load under Vite. Import this module
// (for its side effect) in any page that uses a plain L.marker().
//
// mergeOptions() alone isn't enough: Leaflet's _getIconUrl() still prefixes
// every URL with the image folder it sniffs from leaflet.css, so the
// already-bundled URL came out as
//   /node_modules/leaflet/dist/images//node_modules/leaflet/dist/images/marker-icon.png
// and the marker rendered as a broken image (the passenger's bus marker on
// LiveTracking included). Removing that override makes Leaflet use the
// bundled URLs exactly as given.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});
