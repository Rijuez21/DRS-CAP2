import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { formatDate } from "../../lib/format";

export default function DriverProfile() {
  const { user } = useAuth();
  const [driver, setDriver] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    api
      .getDriver(user.id)
      .then(setDriver)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [user]);

  // The ERD only names name/license_number/phoneno/hire_date as "key
  // attributes" — duty status is described in the admin UI but not given
  // a fixed column name, so this checks both common names rather than
  // guessing wrong and silently showing nothing.
  const dutyStatus = driver?.status ?? driver?.duty_status ?? null;

  return (
    <div className="p-6 space-y-4 max-w-lg">
      <header>
        <h1 className="text-xl font-bold">My Profile</h1>
        <p className="text-sm text-gray-500">
          Read-only — contact an administrator to update any of this.
        </p>
      </header>

      {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !driver ? (
        <p className="text-sm text-gray-500">Profile not found.</p>
      ) : (
        <div className="bg-white rounded-lg border p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-semibold">{driver.name ?? user?.name}</p>
              <p className="text-sm text-gray-500">{user?.email}</p>
            </div>
            {dutyStatus && (
              <span
                className={`text-xs font-medium px-2 py-1 rounded-full ${
                  dutyStatus === "Active"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {dutyStatus}
              </span>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm pt-2 border-t">
            <Field label="License Number" value={driver.license_number} />
            <Field label="Phone Number" value={driver.phoneno} />
            <Field label="Hire Date" value={formatDate(driver.hire_date)} />
          </dl>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="font-medium">{value ?? "—"}</dd>
    </div>
  );
}