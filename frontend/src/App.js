import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Toaster } from "sonner";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Portfolio from "@/pages/Portfolio";
import Market from "@/pages/Market";
import Groups from "@/pages/Groups";
import Fixtures from "@/pages/Fixtures";
import Bracket from "@/pages/Bracket";
import Ledger from "@/pages/Ledger";
import AdminPanel from "@/pages/AdminPanel";
import "@/index.css";

function Protected({ children, admin = false }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-cyan-300 text-sm tracking-widest">
        در حال بارگذاری...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== "admin") return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <AuthProvider>
      <Toaster position="top-center" theme="dark" richColors closeButton />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Protected><Dashboard /></Protected>} />
          <Route path="/portfolio" element={<Protected><Portfolio /></Protected>} />
          <Route path="/market" element={<Protected><Market /></Protected>} />
          <Route path="/groups" element={<Protected><Groups /></Protected>} />
          <Route path="/fixtures" element={<Protected><Fixtures /></Protected>} />
          <Route path="/bracket" element={<Protected><Bracket /></Protected>} />
          <Route path="/ledger" element={<Protected><Ledger /></Protected>} />
          <Route path="/admin" element={<Protected admin><AdminPanel /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
