import React, { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./client/AuthContext";
import { AppShell } from "./components/AppShell";
import { NewMeetingModal } from "./components/NewMeetingModal";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { MeetingsPage } from "./pages/MeetingsPage";
import { MeetingDetailPage } from "./pages/MeetingDetailPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Loader2 } from "lucide-react";

function ProtectedWorkspaceRoutes() {
  const { loading, authenticated } = useAuth();
  const navigate = useNavigate();
  const [newMeetingOpen, setNewMeetingOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 text-zinc-500 text-sm dark:bg-zinc-950">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading...
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      <AppShell onOpenNewMeeting={() => setNewMeetingOpen(true)}>
        <Routes>
          <Route
            path="/"
            element={
              <DashboardPage
                onOpenNewMeeting={() => setNewMeetingOpen(true)}
                refreshTrigger={refreshTrigger}
              />
            }
          />
          <Route
            path="/meetings"
            element={
              <MeetingsPage
                onOpenNewMeeting={() => setNewMeetingOpen(true)}
                refreshTrigger={refreshTrigger}
              />
            }
          />
          <Route path="/meetings/:id" element={<MeetingDetailPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>

      <NewMeetingModal
        open={newMeetingOpen}
        onClose={() => setNewMeetingOpen(false)}
        onCreated={(meetingId) => {
          setRefreshTrigger((n) => n + 1);
          navigate(`/meetings/${meetingId}`);
        }}
      />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          <Route path="/*" element={<ProtectedWorkspaceRoutes />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
