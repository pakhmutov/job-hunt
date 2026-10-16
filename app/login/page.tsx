"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import s from "./login.module.css";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: true },
    });
    if (error) { setError(error.message); setState("error"); } else setState("sent");
  }

  return (
    <main className={s.wrap}>
      <form className={s.card} onSubmit={onSubmit}>
        <h1>Job Hunt</h1>
        {state === "sent" ? (
          <p>Check <strong>{email}</strong> for a sign-in link. You can close this tab.</p>
        ) : (
          <>
            <p className={s.muted}>Sign in with a one-time link sent to your email.</p>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <button className="primary" type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Send sign-in link"}
            </button>
            {state === "error" && <p className={s.error}>Couldn&apos;t send the link: {error}</p>}
          </>
        )}
      </form>
    </main>
  );
}
