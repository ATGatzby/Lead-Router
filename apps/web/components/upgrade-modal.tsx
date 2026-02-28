"use client";

import { Dialog } from "radix-ui";
import { X, Check, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Plan {
  name: string;
  priceMonthly: number;
  seats: number;
  routingLeads: number;
  features: string[];
  highlight: boolean;
  isCurrent: boolean;
}

const PLANS: Plan[] = [
  {
    name: "Free",
    priceMonthly: 0,
    seats: 5,
    routingLeads: 100,
    features: [
      "5 licensed users",
      "100 leads routed/month",
      "Unlimited routing rules",
      "Round-robin teams",
      "30-day routing history",
      "Email support",
    ],
    highlight: false,
    isCurrent: true,
  },
  {
    name: "Paid",
    priceMonthly: 4999,
    seats: 20,
    routingLeads: 1000,
    features: [
      "20 licensed users",
      "1,000 leads routed/month",
      "Everything in Free",
      "Webhook notifications",
      "WhatsApp alerts",
      "Priority support",
      "GST invoice",
    ],
    highlight: true,
    isCurrent: false,
  },
  {
    name: "Enterprise",
    priceMonthly: 0,
    seats: 0,
    routingLeads: 0,
    features: [
      "Unlimited licensed users",
      "Unlimited routing",
      "Everything in Paid",
      "Custom SLA",
      "Dedicated CSM",
      "SSO / SAML",
      "Data residency (India)",
    ],
    highlight: false,
    isCurrent: false,
  },
];

function formatINR(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

interface Props {
  open: boolean;
  onClose: () => void;
  context?: "seats" | "quota";
}

const CONTEXT_COPY = {
  seats: "You've reached your seat limit. Upgrade to license more users.",
  quota: "You've hit your monthly routing limit. Upgrade to route more leads.",
};

export function UpgradeModal({ open, onClose, context }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-3xl rounded-xl bg-background border shadow-xl p-6 focus:outline-none">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <Dialog.Title className="text-lg font-semibold">Upgrade Plan</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button className="rounded-md p-1 hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {context && (
            <p className="text-sm font-medium text-foreground mb-2">
              {CONTEXT_COPY[context]}
            </p>
          )}
          <p className="text-sm text-muted-foreground mb-6">
            All prices in INR + 18% GST. Annual billing saves 20%.
          </p>

          <div className="grid grid-cols-3 gap-4">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-lg border p-5 flex flex-col gap-4 ${
                  plan.highlight
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : ""
                }`}
              >
                {plan.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground whitespace-nowrap">
                    Most Popular
                  </span>
                )}
                {plan.isCurrent && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-muted border px-3 py-0.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                    Current Plan
                  </span>
                )}

                <div>
                  <p className="font-semibold text-sm">{plan.name}</p>
                  {plan.priceMonthly > 0 ? (
                    <div className="mt-1">
                      <span className="text-2xl font-bold">{formatINR(plan.priceMonthly)}</span>
                      <span className="text-xs text-muted-foreground">/mo</span>
                    </div>
                  ) : plan.name === "Enterprise" ? (
                    <p className="text-2xl font-bold mt-1">Custom</p>
                  ) : (
                    <p className="text-2xl font-bold mt-1">Free</p>
                  )}
                  {plan.seats > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {plan.seats} users · {plan.routingLeads.toLocaleString()} leads/mo
                    </p>
                  )}
                </div>

                <ul className="space-y-2 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  variant={plan.highlight ? "default" : "outline"}
                  size="sm"
                  className="w-full"
                  onClick={() =>
                    window.open("mailto:sales@leadrouter.in?subject=Upgrade+to+" + plan.name, "_blank")
                  }
                >
                  {plan.priceMonthly > 0 ? "Get Started" : "Contact Sales"}
                </Button>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground text-center mt-6">
            Need help choosing?{" "}
            <a href="mailto:sales@leadrouter.in" className="text-primary hover:underline">
              Talk to our team
            </a>
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
