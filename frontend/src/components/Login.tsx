import { useEffect, useRef } from "react";
import { config } from "../config";
import { api } from "../api";
import { useApp } from "../store";

declare global {
  interface Window { google?: any; }
}

export function Login() {
  const ref = useRef<HTMLDivElement>(null);
  const { setTeacher } = useApp();

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (!ref.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: async (response: any) => {
          try {
            const data = await api.login(response.credential);
            setTeacher({ id: data.teacherId, email: data.email, name: data.name, picture: data.picture });
          } catch (e) { alert(e instanceof Error ? e.message : "Google sign-in failed"); }
        },
      });
      window.google.accounts.id.renderButton(ref.current, { theme: "outline", size: "large", width: 260 });
    };
    document.head.appendChild(script);
    return () => script.remove();
  }, [setTeacher]);

  return <div className="login-card"><div className="brand big"><span className="brand-mark">Q</span><span>Quizzit</span></div><h1>Create listening activities in minutes.</h1><p>Sign in to create, save and share ESL listening activities.</p><div ref={ref} /></div>;
}
