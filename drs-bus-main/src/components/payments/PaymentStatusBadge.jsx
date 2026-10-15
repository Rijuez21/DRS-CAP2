import StatusBadge from "../common/StatusBadge";
import { paymentStatusLabel } from "../../lib/format";

// Payment status in plain words ('Pending' reads "Under review").
export default function PaymentStatusBadge({ status }) {
  return <StatusBadge status={status} label={paymentStatusLabel(status)} />;
}
