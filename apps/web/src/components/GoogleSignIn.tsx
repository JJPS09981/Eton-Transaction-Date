import { useEffect, useRef, useState } from "react";
import { exchangeGoogleToken, getPublicConfig, setToken, type AuthSession } from "../lib/api";

interface GoogleIdApi {
  initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
  renderButton: (target: HTMLElement, options: { theme: string; size: string; width: number }) => void;
}

declare global {
  interface Window { google?: { accounts: { id: GoogleIdApi } } }
}

const SCRIPT_URL = "https://accounts.google.com/gsi/client";
let scriptPromise: Promise<void> | null = null;
let initializedClientId: string | null = null;
let credentialHandler: (credential: string) => void = () => {};

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => { scriptPromise = null; reject(new Error("無法載入 Google 登入")); }, { once: true });
    if (!existing) {
      script.src = SCRIPT_URL;
      script.async = true;
      document.head.append(script);
    }
  });
  return scriptPromise;
}

export function GoogleSignIn({ onSignedIn }: { onSignedIn: (session: AuthSession) => void }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const onSignedInRef = useRef(onSignedIn);
  const signingInRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [buttonReady, setButtonReady] = useState(false);
  onSignedInRef.current = onSignedIn;
  credentialHandler = (credential) => {
    if (signingInRef.current) return;
    signingInRef.current = true;
    setError(null);
    void exchangeGoogleToken(credential)
      .then(({ token, userId }) => {
        setToken(token);
        onSignedInRef.current({ userId });
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "登入失敗"))
      .finally(() => { signingInRef.current = false; });
  };

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    void getPublicConfig().then(async ({ googleClientId }) => {
      if (!googleClientId) throw new Error("Worker 尚未設定 GOOGLE_CLIENT_ID");
      await loadGoogleScript();
      if (cancelled || !window.google?.accounts?.id || !buttonRef.current) return;
      if (initializedClientId !== googleClientId) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: ({ credential }) => credentialHandler(credential),
        });
        initializedClientId = googleClientId;
      }
      const target = buttonRef.current;
      let renderedWidth = 0;
      const render = () => {
        const width = Math.min(320, target.clientWidth);
        if (!width || width === renderedWidth) return;
        renderedWidth = width;
        target.replaceChildren();
        window.google?.accounts.id.renderButton(target, { theme: "outline", size: "large", width });
      };
      render();
      observer = new ResizeObserver(render);
      observer.observe(target);
      setButtonReady(true);
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "無法載入登入設定");
    });
    return () => { cancelled = true; observer?.disconnect(); };
  }, []);

  return <div className="login-page"><div className="login-card">
    <span className="brand">日日花</span>
    <h1>今天還能花多少，現在就知道。</h1>
    <p>把收入、固定支出與存款變成每天看得懂的可用預算。</p>
    <div className="google-button" ref={buttonRef} aria-label="使用 Google 登入" />
    {!buttonReady && !error && <p className="login-hint">正在載入 Google 登入…</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
  </div></div>;
}
