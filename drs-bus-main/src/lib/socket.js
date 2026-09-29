import { io } from "socket.io-client";
import { BASE_URL } from "./api";

let socket;
let socketToken = null;

/** Lazily creates one shared socket connection for the whole app. */
export function getSocket() {
  if (!socket) {
    // auth is read on every (re)connect, so a login/logout takes effect
    // after setSocketToken() reconnects below.
    socket = io(BASE_URL, { autoConnect: true, auth: (cb) => cb({ token: socketToken }) });
  }
  return socket;
}

// Private rooms (driver:<id>, passenger:<id>, fleet) are only joined for a
// socket that proved who it is with the login token. When the user logs in
// or out, reconnect so the server sees the new identity; pages re-join
// their rooms on the "connect" event.
export function setSocketToken(token) {
  const next = token ?? null;
  if (next === socketToken) return;
  socketToken = next;
  if (socket) {
    socket.disconnect();
    socket.connect();
  }
}
