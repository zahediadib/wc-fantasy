import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    const r = await login(username.trim(), password);
    setLoading(false);
    if (r.ok) nav("/");
    else setErr(r.error);
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center relative"
      dir="rtl"
      style={{
        backgroundImage:
          "linear-gradient(rgba(6,11,25,0.85), rgba(6,11,25,0.95)), url('https://images.unsplash.com/photo-1522778119026-d647f0596c20?crop=entropy&cs=srgb&fm=jpg&q=85')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "radial-gradient(800px 400px at 20% 10%, rgba(157,76,221,0.25), transparent 60%), radial-gradient(800px 400px at 80% 90%, rgba(0,255,255,0.18), transparent 60%)"
      }} />
      <form
        onSubmit={onSubmit}
        className="relative z-10 glass rounded-3xl p-8 w-full max-w-md mx-4 border border-white/10"
        data-testid="login-form"
      >
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-400 flex items-center justify-center glow-purple mb-3">
            <Trophy className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tight">جام جهانی ۲۰۲۶</h1>
          <p className="text-xs text-cyan-300 mono tracking-[0.2em] mt-1 uppercase">Fantasy Trading League</p>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-gray-300 mb-1.5 block">نام کاربری</Label>
            <Input
              data-testid="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="bg-black/40 border-white/10 text-white"
              dir="ltr"
              placeholder="Username"
            />
          </div>
          <div>
            <Label className="text-xs text-gray-300 mb-1.5 block">رمز عبور</Label>
            <Input
              data-testid="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-black/40 border-white/10 text-white"
              dir="ltr"
              placeholder="Password"
            />
          </div>
          {err && (
            <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2 text-center" data-testid="login-error">
              {err}
            </div>
          )}
          <Button
            type="submit"
            data-testid="login-submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-fuchsia-500 to-violet-500 hover:opacity-95 text-white font-bold"
          >
            {loading ? "در حال ورود..." : "ورود"}
          </Button>
        </div>

        <div className="mt-6 text-[11px] text-gray-400 text-center leading-relaxed">
          برای ساخت حساب کاربری با مدیر تورنمنت تماس بگیرید.
        </div>
      </form>
    </div>
  );
}
