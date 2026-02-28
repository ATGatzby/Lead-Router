"use client";

import { useState } from "react";
import { MessageSquare, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type State = "idle" | "submitting" | "success" | "error";

const CATEGORIES = ["General", "Bug Report", "Feature Request"] as const;

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<string>("General");
  const [errorText, setErrorText] = useState("");

  const reset = () => {
    setState("idle");
    setMessage("");
    setCategory("General");
    setErrorText("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    setOpen(next);
  };

  const handleSubmit = async () => {
    if (message.trim().length < 10 || state === "submitting") return;

    setState("submitting");
    setErrorText("");

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim(), category }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to send");
      }

      setState("success");
      setTimeout(() => {
        setOpen(false);
        setTimeout(reset, 300); // wait for close animation
      }, 1500);
    } catch (err) {
      setState("error");
      setErrorText(err instanceof Error ? err.message : "Failed to send. Please try again.");
    }
  };

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background shadow-lg hover:opacity-90 transition-opacity"
        aria-label="Send feedback"
      >
        <MessageSquare className="h-4.5 w-4.5" />
      </button>

      {/* Feedback dialog */}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          {state === "success" ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <div>
                <p className="font-semibold text-base">Thanks for your feedback!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  We read every message and use it to improve Lead Router.
                </p>
              </div>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Send Feedback</DialogTitle>
                <DialogDescription>
                  Your message goes directly to our team.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-1">
                <div className="space-y-1.5">
                  <Label htmlFor="feedback-category">Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger id="feedback-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="feedback-message">Message</Label>
                  <Textarea
                    id="feedback-message"
                    placeholder="What's on your mind?"
                    className="min-h-[120px] resize-none"
                    value={message}
                    onChange={(e) => {
                      setMessage(e.target.value);
                      if (state === "error") setState("idle");
                    }}
                    disabled={state === "submitting"}
                  />
                  {errorText && (
                    <p className="text-xs text-destructive">{errorText}</p>
                  )}
                  <p className="text-xs text-muted-foreground text-right">
                    {message.length}/2000
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                  disabled={state === "submitting"}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={message.trim().length < 10 || state === "submitting"}
                >
                  {state === "submitting" ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    "Send Feedback"
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
