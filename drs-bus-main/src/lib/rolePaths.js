// Each role's own login page and home, so a bounced or logged-out user
// lands somewhere that makes sense for them.
export const LOGIN_PATH = { passenger: "/login/passenger", driver: "/login/staff", staff: "/login/staff?as=staff", admin: "/login/admin", owner: "/login/owner" };
export const HOME_PATH = { passenger: "/passenger/home", driver: "/driver/dashboard", staff: "/staff/walk-in", admin: "/admin/dashboard", owner: "/owner/tracking" };

// Where Log Out takes a role: passengers go back to the landing page;
// driver/staff/admin/owner go back to their own login page (the landing page
// only links to the passenger login, so they'd otherwise be stranded there).
export function logoutPath(role) {
  return role && role !== "passenger" ? LOGIN_PATH[role] ?? "/" : "/";
}
