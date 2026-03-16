"use client"

import { useState, useEffect } from "react"
import { ThumbsUp, ThumbsDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface FeedbackButtonsProps {
  userMessage: string
  aiResponse: string
  toolsUsed?: string[]
  context?: string
}

export function FeedbackButtons({ userMessage, aiResponse, toolsUsed, context }: FeedbackButtonsProps) {
  const [rating, setRating] = useState<"positive" | "negative" | null>(null)
  const [showFeedbackInput, setShowFeedbackInput] = useState(false)
  const [feedbackText, setFeedbackText] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [showThanks, setShowThanks] = useState(false)

  const handleRate = async (newRating: "positive" | "negative") => {
    if (submitted || rating) return
    setRating(newRating)
    if (newRating === "negative") {
      setShowFeedbackInput(true)
      return
    }
    await submitFeedback(newRating, "")
  }

  const submitFeedback = async (r: string, text: string) => {
    try {
      await fetch("/api/ai/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: r,
          userMessage,
          aiResponse: aiResponse.slice(0, 2000),
          toolsUsed,
          context,
          feedback: text || undefined,
        }),
      })
      setSubmitted(true)
      setShowFeedbackInput(false)
      setShowThanks(true)
    } catch {
      // Silently fail — feedback is best-effort
    }
  }

  const handleNegativeSubmit = () => {
    submitFeedback("negative", feedbackText)
  }

  // Fade out thanks message after 2 seconds
  useEffect(() => {
    if (!showThanks) return
    const timer = setTimeout(() => setShowThanks(false), 2000)
    return () => clearTimeout(timer)
  }, [showThanks])

  if (submitted && !showThanks) return null

  return (
    <div className="mt-1.5 ml-10">
      {showThanks ? (
        <p className="text-[11px] text-muted-foreground/60 animate-in fade-in duration-200">
          Thanks for your feedback
        </p>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleRate("positive")}
              disabled={!!rating}
              className={cn(
                "inline-flex items-center justify-center rounded-md p-1 transition-colors",
                "text-muted-foreground/40 hover:text-muted-foreground/80 hover:bg-muted/50",
                rating === "positive" && "text-green-500 dark:text-green-400",
                rating === "negative" && "opacity-30"
              )}
              aria-label="Good response"
            >
              <ThumbsUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => handleRate("negative")}
              disabled={!!rating}
              className={cn(
                "inline-flex items-center justify-center rounded-md p-1 transition-colors",
                "text-muted-foreground/40 hover:text-muted-foreground/80 hover:bg-muted/50",
                rating === "negative" && "text-red-500 dark:text-red-400",
                rating === "positive" && "opacity-30"
              )}
              aria-label="Bad response"
            >
              <ThumbsDown className="h-3 w-3" />
            </button>
          </div>

          {showFeedbackInput && (
            <div className="mt-1.5 flex items-center gap-2 animate-in slide-in-from-top-1 duration-200">
              <input
                type="text"
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleNegativeSubmit()}
                placeholder="What went wrong? (optional)"
                className={cn(
                  "h-7 w-56 rounded-md border bg-background px-2 text-[11px]",
                  "placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
                )}
                autoFocus
              />
              <button
                type="button"
                onClick={handleNegativeSubmit}
                className={cn(
                  "h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors",
                  "bg-muted hover:bg-muted/80 text-muted-foreground"
                )}
              >
                Submit
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
