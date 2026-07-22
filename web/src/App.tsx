import { lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ApiKeyProvider } from "@/components/layout/ApiKeyProvider";
import { KeyGate } from "@/components/layout/KeyGate";
import { AppLayout } from "@/components/layout/AppLayout";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Overview } from "@/pages/Overview";
import { Ranking } from "@/pages/Ranking";
import { Attendance } from "@/pages/Attendance";
import { Members } from "@/pages/Members";
import { Placeholder } from "@/pages/Placeholder";

// Route-split so the initial load stays small. MemberProfile is the only page that pulls in recharts
// (~107 kB gzip), and the admin pages are irrelevant to most viewers. The layouts render these behind a
// Suspense boundary. Pages use named exports, hence the .then() remap to a default.
const MemberProfile = lazy(() =>
  import("@/pages/MemberProfile").then((m) => ({ default: m.MemberProfile })),
);
const Events = lazy(() => import("@/pages/Events").then((m) => ({ default: m.Events })));
const Roster = lazy(() => import("@/pages/Roster").then((m) => ({ default: m.Roster })));
const Aliases = lazy(() => import("@/pages/Aliases").then((m) => ({ default: m.Aliases })));
const Scoring = lazy(() => import("@/pages/Scoring").then((m) => ({ default: m.Scoring })));
const Backup = lazy(() => import("@/pages/Backup").then((m) => ({ default: m.Backup })));

export default function App() {
  return (
    <ApiKeyProvider>
      <KeyGate>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Overview />} />
              <Route path="/rankings" element={<Ranking initialScope="overall" />} />
              <Route path="/rankings/overall" element={<Ranking initialScope="overall" />} />
              <Route path="/attendance" element={<Attendance />} />
              <Route path="/members" element={<Members />} />
              <Route path="/members/:id" element={<MemberProfile />} />
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="/admin/events" replace />} />
                <Route path="events" element={<Events />} />
                <Route path="roster" element={<Roster />} />
                <Route path="aliases" element={<Aliases />} />
                <Route path="scoring" element={<Scoring />} />
                <Route path="backup" element={<Backup />} />
              </Route>
              <Route path="*" element={<Placeholder title="Not found" />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </KeyGate>
    </ApiKeyProvider>
  );
}
