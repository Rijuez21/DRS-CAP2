import { io } from "socket.io-client";
import { BASE_URL } from "./api";

let socket;

/** Lazily creates one shared socket connection for the whole app. */
export function getSocket() {
  if (!socket) {
    socket = io(BASE_URL, { autoConnect: true });
  }
  return socket;
}
