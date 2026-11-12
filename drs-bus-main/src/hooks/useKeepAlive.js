import { useEffect, useId } from "react";
import { holdAwake } from "../lib/idle";

// While `enabled`, this page counts as "in use" for the inactivity sign-out
// (lib/idle.js): someone watching their bus on Live Tracking, or waiting on
// the payment step, isn't idle. evenWhenHidden keeps it going with the
// screen off — for a driver's running trip only.
export function useKeepAlive(enabled = true, { evenWhenHidden = false } = {}) {
  const id = useId();
  useEffect(() => (enabled ? holdAwake(id, { evenWhenHidden }) : undefined), [id, enabled, evenWhenHidden]);
}
