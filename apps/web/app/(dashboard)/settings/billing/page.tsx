"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface BillingInfo {
  id: string;
  entityName?: string | null;
  gstin?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  pinCode?: string | null;
  invoiceEmail?: string | null;
}

interface BillingData {
  billing: BillingInfo | null;
}

const INDIA_STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat",
  "Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh",
  "Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab",
  "Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand",
  "West Bengal","Delhi","Jammu and Kashmir","Ladakh",
];

async function fetchBilling(): Promise<BillingData> {
  const res = await fetch("/api/settings/billing");
  if (!res.ok) throw new Error("Failed to fetch billing");
  return res.json();
}

async function saveBilling(data: Partial<BillingInfo>) {
  const res = await fetch("/api/settings/billing", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save billing info");
  return res.json();
}

export default function BillingSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings-billing"], queryFn: fetchBilling });

  const billing = data?.billing;

  const [form, setForm] = useState<Partial<BillingInfo>>({});
  const [saved, setSaved] = useState(false);

  const values = { ...billing, ...form };
  const set = (key: keyof BillingInfo, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const mutation = useMutation({
    mutationFn: saveBilling,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings-billing"] });
      setForm({});
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-lg border p-6 space-y-5">
        <div>
          <h2 className="font-semibold">GST Billing Information</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Used on tax invoices sent to your registered email. GST rate: 18%.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1.5">
            <Label>Legal Entity Name</Label>
            <Input
              placeholder="Acme Technologies Pvt Ltd"
              value={values.entityName ?? ""}
              onChange={(e) => set("entityName", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>GSTIN</Label>
            <Input
              placeholder="22AAAAA0000A1Z5"
              value={values.gstin ?? ""}
              onChange={(e) => set("gstin", e.target.value.toUpperCase())}
              maxLength={15}
            />
            <p className="text-xs text-muted-foreground">15-character GST Identification Number</p>
          </div>

          <div className="space-y-1.5">
            <Label>Invoice Email</Label>
            <Input
              type="email"
              placeholder="billing@company.in"
              value={values.invoiceEmail ?? ""}
              onChange={(e) => set("invoiceEmail", e.target.value)}
            />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label>Address Line 1</Label>
            <Input
              placeholder="Building / Street"
              value={values.addressLine1 ?? ""}
              onChange={(e) => set("addressLine1", e.target.value)}
            />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label>Address Line 2 (optional)</Label>
            <Input
              placeholder="Area / Landmark"
              value={values.addressLine2 ?? ""}
              onChange={(e) => set("addressLine2", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>City</Label>
            <Input
              placeholder="Mumbai"
              value={values.city ?? ""}
              onChange={(e) => set("city", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>State / UT</Label>
            <Select value={values.state ?? ""} onValueChange={(v) => set("state", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent>
                {INDIA_STATES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>PIN Code</Label>
            <Input
              placeholder="400001"
              maxLength={6}
              value={values.pinCode ?? ""}
              onChange={(e) => set("pinCode", e.target.value.replace(/\D/g, ""))}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button
            onClick={() => mutation.mutate(values)}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Save Billing Info"}
          </Button>
          {saved && (
            <span className="text-sm text-green-600 font-medium">Saved successfully</span>
          )}
          {mutation.isError && (
            <span className="text-sm text-destructive">Save failed — please retry</span>
          )}
        </div>
      </div>
    </div>
  );
}
