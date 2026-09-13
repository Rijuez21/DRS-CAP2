import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Mail, User as UserIcon } from "lucide-react";
import StatsRow from "../../components/passenger/StatsRow";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";

export default function Profile() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState([]);

  useEffect(() => {
    if (!user) return;
    api.getBookings({ passengerId: user.id }).then(setBookings).catch(() => setBookings([]));
  }, [user]);

  const stats = [
    { label: "Total Bookings", value: bookings.length || null },
    {
      label: "Confirmed",
      value: bookings.filter((b) => b.status === "Confirmed" || b.status === "Boarded").length || null,
    },
    { label: "Cancelled", value: bookings.filter((b) => b.status === "Cancelled").length || null },
  ];

  function handleLogout() {
    signOut();
    navigate("/");
  }

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-5">
      <header className="flex flex-col items-center text-center gap-2">
        <span className="w-16 h-16 rounded-full bg-brand-forest-900 flex items-center justify-center">
          <UserIcon className="w-7 h-7 text-brand-sunrise-400" />
        </span>
        <h1 className="font-display text-xl font-bold">{user?.name ?? "Passenger"}</h1>
        <p className="flex items-center gap-1.5 text-sm text-ink-600">
          <Mail className="w-3.5 h-3.5" /> {user?.email}
        </p>
      </header>

      <StatsRow stats={stats} />

      <button
        type="button"
        onClick={handleLogout}
        className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:border-rose-300 hover:text-rose-600 transition-colors font-display font-semibold rounded-xl py-3"
      >
        <LogOut className="w-4 h-4" /> Log Out
      </button>
    </div>
  );
}
