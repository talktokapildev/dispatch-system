"use client";
import { useState } from "react";
import { useAuthStore } from "@/lib/api";
import { Car } from "lucide-react";
import toast from "react-hot-toast";

export default function LoginPage() {
  const [email, setEmail] = useState("admin@dispatch.com");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();

  const handleLogin = async () => {
    if (!email || !password) {
      toast.error("Please enter email and password");
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
      window.location.href = "/dashboard";
    } catch (err) {
      console.error("Login failed:", err);
      toast.error("Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--bg)" }}
    >
      <div className="w-full max-w-sm px-4">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-brand-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Car size={26} className="text-black" />
          </div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text)" }}>
            Dispatch Control
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            TfL Licensed Private Hire
          </p>
        </div>
        <div className="card p-6 space-y-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">
              Email address
            </label>
            <input
              type="text"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">
              Password
            </label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>
          <button
            onClick={handleLogin}
            disabled={loading}
            className="btn-primary w-full justify-center flex mt-2"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-center text-xs text-slate-600">
            Admin access only · TfL Operator System
          </p>
        </div>
      </div>
    </div>
  );
}
