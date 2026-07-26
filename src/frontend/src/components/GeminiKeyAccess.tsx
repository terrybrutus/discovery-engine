import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  hasEncryptedGeminiKey,
  lockGeminiKey,
  removeEncryptedGeminiKey,
  saveGeminiKeyWithPin,
  setGeminiKey,
  unlockGeminiKey,
  useGeminiKey,
} from "@/lib/geminiKeyVault";
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState } from "react";

export function GeminiKeyAccess({
  idPrefix,
  compact = false,
}: {
  idPrefix: string;
  compact?: boolean;
}) {
  const apiKey = useGeminiKey();
  const [credential, setCredential] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const saved = hasEncryptedGeminiKey();

  const handleCredential = async () => {
    const value = credential.trim();
    if (!value) return;
    setBusy(true);
    setMessage("");
    try {
      if (/^\d{4,12}$/.test(value) && saved) {
        await unlockGeminiKey(value);
        setMessage("Gemini key unlocked for this session.");
      } else if (value.length >= 20) {
        setGeminiKey(value);
        setMessage("Gemini key is available for this session.");
      } else {
        throw new Error(
          saved
            ? "Enter your 4–12 digit PIN or paste the full Gemini API key."
            : "Paste the full Gemini API key.",
        );
      }
      setCredential("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Gemini access failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remember = async () => {
    setBusy(true);
    setMessage("");
    try {
      await saveGeminiKeyWithPin(apiKey, pin);
      setPin("");
      setMessage(
        "Encrypted on this browser. Next time, enter only your PIN to unlock it.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save key.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={
        compact
          ? "rounded-md border border-border bg-background/40 p-3"
          : "rounded-lg border border-primary/20 bg-primary/5 p-4"
      }
    >
      <div className="flex items-start gap-2">
        {apiKey ? (
          <ShieldCheck className="mt-0.5 size-4 text-primary" />
        ) : (
          <KeyRound className="mt-0.5 size-4 text-primary" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">
            Gemini access{" "}
            {apiKey ? "ready" : saved ? "locked" : "not connected"}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {saved
              ? "Enter your PIN to unlock the encrypted key, or paste a different full key."
              : "Paste a Gemini API key. You can optionally encrypt it on this browser with a short PIN."}
          </p>
        </div>
      </div>

      {!apiKey ? (
        <div className="mt-2 flex gap-2">
          <Input
            id={`${idPrefix}-gemini-credential`}
            type="password"
            autoComplete="off"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleCredential();
            }}
            placeholder={
              saved ? "PIN or full Gemini API key" : "Gemini API key"
            }
            aria-label="Gemini API key or PIN"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void handleCredential()}
            disabled={!credential.trim() || busy}
          >
            {saved && /^\d{4,12}$/.test(credential.trim())
              ? "Unlock"
              : "Use key"}
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Input
            id={`${idPrefix}-gemini-pin`}
            className="min-w-36 flex-1"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={pin}
            onChange={(event) =>
              setPin(event.target.value.replace(/\D/g, "").slice(0, 12))
            }
            placeholder={
              saved ? "New PIN (optional)" : "4–12 digit PIN (optional)"
            }
            aria-label="PIN for encrypted Gemini key"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void remember()}
            disabled={!/^\d{4,12}$/.test(pin) || busy}
          >
            <LockKeyhole className="size-3.5" />
            {saved ? "Update PIN" : "Remember"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              lockGeminiKey();
              setMessage("Gemini key locked.");
            }}
          >
            Lock
          </Button>
          {saved ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                removeEncryptedGeminiKey();
                setMessage("Encrypted Gemini key removed from this browser.");
              }}
            >
              Forget
            </Button>
          ) : null}
        </div>
      )}

      {message ? (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {message}
        </p>
      ) : null}
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        The PIN-derived encryption stays on this browser. The key is sent only
        to Google when you request a Gemini operation; it is never included in
        saved runs or definition exports. A short PIN is convenient protection,
        not a substitute for securing the device and browser profile.
      </p>
    </div>
  );
}
