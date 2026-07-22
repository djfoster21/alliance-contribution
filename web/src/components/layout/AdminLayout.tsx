import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { LoadingState } from "@/components/States";
import { AdminTabs } from "./AdminTabs";

export function AdminLayout() {
  return (
    <div className="flex flex-col gap-6">
      <AdminTabs />
      {/* Inner boundary so switching admin tabs doesn't tear down the tab bar with them. */}
      <Suspense fallback={<LoadingState />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
