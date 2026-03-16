"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Search, Users, Trash2, Plug, X, Check, ChevronDown,
  User, Star, CreditCard, Inbox, CheckSquare,
  Zap, BarChart3, Clock, RefreshCw, AlertTriangle, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { TableSkeleton } from "@/components/skeletons/table-skeleton";
import { AgentChatPanel } from "@/components/ai-chat/AgentChatPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserRecord {
  id: string;
  sfdcUserId: string;
  name: string;
  email: string;
  role: string | null;
  profile: string | null;
  department: string | null;
  isLicensed: boolean;
  licensedVia: string | null;
  lastRoutedAt: string | null;
  teamMemberships?: Array<{ team: { id: string; name: string } }>;
}

interface UsersResponse {
  users: UserRecord[];
  total: number;
  page: number;
  pages: number;
}

interface StatsResponse {
  seatsPurchased: number;
  seatsUsed: number;
  breakdown: {
    individual: number;
    byRole: number;
    byProfile: number;
    byCustomField: number;
    licensedQueues: number;
  };
}

interface FiltersResponse {
  roles: string[];
  profiles: string[];
  departments: string[];
}

interface QueueRecord {
  id: string;
  name: string;
  sfdcQueueId: string;
  memberCount?: number;
  isLicensed?: boolean;
}

interface LicenseResponse {
  tier: "free" | "pro";
  limits: {
    maxSeats: number; // -1 means unlimited
    maxRules: number;
    maxOrgs: number;
    allowedTriggers: string[];
    weightedDistribution: boolean;
    analytics: boolean;
    auditLog: boolean;
  };
  usage: {
    seats: number;
    rules: number;
    orgs: number;
  };
  licenseKey: string | null;
}

type LicensingMethod = "individual" | "role" | "profile" | "queue" | "custom";
type ActiveTab = "users" | "overview";

// ─── Method Card Config ───────────────────────────────────────────────────────

const METHOD_CARDS: {
  key: LicensingMethod;
  label: string;
  description: string;
  icon: typeof User;
  iconBg: string;
  iconColor: string;
  tagColor: string;
}[] = [
  {
    key: "individual",
    label: "Individual Users",
    description: "Pick specific people",
    icon: User,
    iconBg: "bg-purple-50 dark:bg-purple-950",
    iconColor: "text-purple-500 dark:text-purple-400",
    tagColor: "bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  },
  {
    key: "role",
    label: "By Role",
    description: "License entire roles",
    icon: Star,
    iconBg: "bg-blue-50 dark:bg-blue-950",
    iconColor: "text-blue-600 dark:text-blue-400",
    tagColor: "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  },
  {
    key: "profile",
    label: "By Profile",
    description: "License by SF profile",
    icon: CreditCard,
    iconBg: "bg-teal-50 dark:bg-teal-950",
    iconColor: "text-teal-500 dark:text-teal-400",
    tagColor: "bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800",
  },
  {
    key: "queue",
    label: "By Queue",
    description: "License queues directly",
    icon: Inbox,
    iconBg: "bg-orange-50 dark:bg-orange-950",
    iconColor: "text-orange-500 dark:text-orange-400",
    tagColor: "bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800",
  },
  {
    key: "custom",
    label: "By Custom Field",
    description: "User field = true",
    icon: CheckSquare,
    iconBg: "bg-green-50 dark:bg-green-950",
    iconColor: "text-green-500 dark:text-green-400",
    tagColor: "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function LicenseUsersPage() {
  const queryClient = useQueryClient();

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<ActiveTab>("users");

  // ── Selection panel state ──
  const [activeMethod, setActiveMethod] = useState<LicensingMethod | null>(null);
  const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set());
  const [panelSearchQuery, setPanelSearchQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelSearchRef = useRef<HTMLInputElement>(null);

  // ── AI License modal state ──
  const [showAILicense, setShowAILicense] = useState(false);

  // ── Method applied state (gate user table until a method is used) ──
  const [hasAppliedMethod, setHasAppliedMethod] = useState(false);

  // ── Custom field 2-step state ──
  const [selectedCustomField, setSelectedCustomField] = useState<string | null>(null);
  const [customFieldValue, setCustomFieldValue] = useState("");

  // ── Table state ──
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState("all");
  const [profileFilter, setProfileFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // ── Data queries ──
  const { data: usersData, isLoading: usersLoading } = useQuery<UsersResponse>({
    queryKey: ["license-users", search, page, statusFilter, roleFilter, profileFilter, departmentFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      if (statusFilter === "licensed") params.set("licensed", "true");
      else if (statusFilter === "unlicensed") params.set("licensed", "false");
      if (roleFilter !== "all") params.set("role", roleFilter);
      if (profileFilter !== "all") params.set("profile", profileFilter);
      if (departmentFilter !== "all") params.set("department", departmentFilter);
      const res = await fetch(`/api/users?${params}`);
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });

  const { data: stats, isLoading: statsLoading } = useQuery<StatsResponse>({
    queryKey: ["license-stats"],
    queryFn: async () => {
      const res = await fetch("/api/users/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const { data: licenseData } = useQuery<LicenseResponse>({
    queryKey: ["license-info"],
    queryFn: async () => {
      const res = await fetch("/api/license");
      if (!res.ok) throw new Error("Failed to fetch license info");
      return res.json();
    },
  });

  const { data: filters } = useQuery<FiltersResponse>({
    queryKey: ["license-filters"],
    queryFn: async () => {
      const res = await fetch("/api/users/filters");
      if (!res.ok) throw new Error("Failed to fetch filters");
      return res.json();
    },
  });

  const { data: queues } = useQuery<QueueRecord[]>({
    queryKey: ["queues-list"],
    queryFn: async () => {
      const res = await fetch("/api/queues");
      if (!res.ok) throw new Error("Failed to fetch queues");
      const data = await res.json();
      return Array.isArray(data) ? data : data.queues ?? [];
    },
    enabled: activeMethod === "queue",
  });

  // ── Panel options for the active method ──
  const panelAllUsers = useQuery<UsersResponse>({
    queryKey: ["license-users-all-for-panel"],
    queryFn: async () => {
      const res = await fetch("/api/users?page=1&limit=500");
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    enabled: activeMethod === "individual" || activeMethod === "role" || activeMethod === "profile",
  });

  // Fetch custom fields on the User object from FieldSchema
  const { data: customFields } = useQuery<{ id: string; fieldApiName: string; fieldLabel: string; fieldType: string; picklistValues: string[] | null }[]>({
    queryKey: ["user-custom-fields"],
    queryFn: async () => {
      const res = await fetch("/api/fields?objectType=User&customOnly=true");
      if (!res.ok) throw new Error("Failed to fetch custom fields");
      const data = await res.json();
      return Array.isArray(data) ? data : data.fields ?? [];
    },
    enabled: activeMethod === "custom",
  });

  // ── Sync mutations ──
  const syncUsers = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/users", { method: "POST" });
      if (!res.ok) throw new Error("Failed to sync users");
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Users synced from Salesforce");
    },
    onError: () => toast.error("Failed to sync users from Salesforce"),
  });

  const syncQueuesM = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/queues/sync", { method: "POST" });
      if (!res.ok) throw new Error("Failed to sync queues");
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Queues synced from Salesforce");
    },
    onError: () => toast.error("Failed to sync queues from Salesforce"),
  });

  // Auto-sync on first load if no users exist
  const hasSynced = useRef(false);
  useEffect(() => {
    if (!usersLoading && usersData && usersData.total === 0 && !hasSynced.current && !syncUsers.isPending) {
      hasSynced.current = true;
      syncUsers.mutate();
      syncQueuesM.mutate();
    }
  }, [usersLoading, usersData]);

  // ── Mutations ──
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["license-users"] });
    queryClient.invalidateQueries({ queryKey: ["license-stats"] });
    queryClient.invalidateQueries({ queryKey: ["license-filters"] });
    queryClient.invalidateQueries({ queryKey: ["license-users-all-for-panel"] });
    queryClient.invalidateQueries({ queryKey: ["queues-list"] });
    queryClient.invalidateQueries({ queryKey: ["license-info"] });
  };

  const licenseSingle = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/users/${userId}/license`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 402 && (body.error === "upgrade_required" || body.error === "seat_cap_exceeded")) {
          const maxSeats = licenseData?.limits?.maxSeats;
          const limitLabel = maxSeats && maxSeats > 0 ? maxSeats : 3;
          throw new Error(`upgrade_required:No licenses available. You've used all ${limitLabel} free licenses. Upgrade to Pro for unlimited.`);
        }
        throw new Error("Failed to license user");
      }
    },
    onSuccess: () => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["license-info"] });
      toast.success("User licensed");
    },
    onError: (err: Error) => {
      if (err.message.startsWith("upgrade_required:")) {
        toast.error(err.message.replace("upgrade_required:", ""));
      } else {
        toast.error("Failed to license user");
      }
    },
  });

  const deLicenseSingle = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/users/${userId}/de-license`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to de-license user");
    },
    onSuccess: () => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["license-info"] });
      toast.success("User de-licensed");
    },
    onError: () => toast.error("Failed to de-license user"),
  });

  const deleteUser = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete user");
    },
    onSuccess: () => { invalidateAll(); toast.success("User removed"); },
    onError: () => toast.error("Failed to remove user"),
  });

  const bulkLicense = useMutation({
    mutationFn: async ({ userIds, action }: { userIds: string[]; action: "license" | "de-license" }) => {
      const res = await fetch("/api/users/bulk-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds, action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 402 && (body.error === "upgrade_required" || body.error === "seat_cap_exceeded")) {
          const maxSeats = licenseData?.limits?.maxSeats;
          const limitLabel = maxSeats && maxSeats > 0 ? maxSeats : 3;
          throw new Error(`upgrade_required:No licenses available. You've used all ${limitLabel} free licenses. Upgrade to Pro for unlimited.`);
        }
        throw new Error("Bulk operation failed");
      }
    },
    onSuccess: (_, vars) => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["license-info"] });
      setSelectedRows(new Set());
      toast.success(`${vars.userIds.length} user${vars.userIds.length > 1 ? "s" : ""} ${vars.action === "license" ? "licensed" : "de-licensed"}`);
    },
    onError: (err: Error) => {
      if (err.message.startsWith("upgrade_required:")) {
        toast.error(err.message.replace("upgrade_required:", ""));
      } else {
        toast.error("Bulk operation failed");
      }
    },
  });

  const bulkDelete = useMutation({
    mutationFn: async (userIds: string[]) => {
      const res = await fetch("/api/users/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds }),
      });
      if (!res.ok) throw new Error("Bulk delete failed");
    },
    onSuccess: (_, userIds) => {
      invalidateAll();
      setSelectedRows(new Set());
      toast.success(`${userIds.length} user${userIds.length > 1 ? "s" : ""} removed`);
    },
    onError: () => toast.error("Bulk delete failed"),
  });

  const licenseByRole = useMutation({
    mutationFn: async (roles: string[]) => {
      const res = await fetch("/api/users/license-by-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles }),
      });
      if (!res.ok) throw new Error("Failed to license by role");
      return res.json();
    },
    onSuccess: (data) => {
      invalidateAll();
      closePanel();
      toast.success(data?.count != null ? `${data.count} users licensed by role` : "Users licensed by role");
    },
    onError: () => toast.error("Failed to license by role"),
  });

  const licenseByProfile = useMutation({
    mutationFn: async (profiles: string[]) => {
      const res = await fetch("/api/users/license-by-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profiles }),
      });
      if (!res.ok) throw new Error("Failed to license by profile");
      return res.json();
    },
    onSuccess: (data) => {
      invalidateAll();
      closePanel();
      toast.success(data?.count != null ? `${data.count} users licensed by profile` : "Users licensed by profile");
    },
    onError: () => toast.error("Failed to license by profile"),
  });

  const licenseByCustomField = useMutation({
    mutationFn: async ({ fieldName, fieldValue }: { fieldName: string; fieldValue: string }) => {
      const res = await fetch("/api/users/license-by-custom-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldName, fieldValue }),
      });
      if (!res.ok) throw new Error("Failed to license by custom field");
      return res.json();
    },
    onSuccess: (data) => {
      invalidateAll();
      closePanel();
      toast.success(data?.count != null ? `${data.count} users licensed by custom field` : "Users licensed by custom field");
    },
    onError: () => toast.error("Failed to license by custom field"),
  });

  const licenseQueues = useMutation({
    mutationFn: async (queueIds: string[]) => {
      const res = await fetch("/api/queues/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueIds }),
      });
      if (!res.ok) throw new Error("Failed to license queues");
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      closePanel();
      toast.success("Queues licensed");
    },
    onError: () => toast.error("Failed to license queues"),
  });

  const licenseIndividualUsers = useMutation({
    mutationFn: async (userIds: string[]) => {
      const res = await fetch("/api/users/bulk-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds, action: "license" }),
      });
      if (!res.ok) throw new Error("Failed to license users");
    },
    onSuccess: (_, userIds) => {
      invalidateAll();
      closePanel();
      toast.success(`${userIds.length} user${userIds.length > 1 ? "s" : ""} licensed`);
    },
    onError: () => toast.error("Failed to license users"),
  });

  // ── Panel options computation ──
  const panelOptions = useMemo(() => {
    if (!activeMethod) return [];

    switch (activeMethod) {
      case "individual": {
        const allUsers = panelAllUsers.data?.users ?? [];
        return allUsers.map((u) => ({
          value: u.id,
          label: u.name,
          sub: u.email,
          count: null as number | null,
          countLabel: null as string | null,
          disabled: u.isLicensed,
          disabledLabel: "Already licensed",
        }));
      }
      case "role": {
        const roles = filters?.roles ?? [];
        const allUsers = panelAllUsers.data?.users ?? usersData?.users ?? [];
        return roles.map((r) => {
          const total = allUsers.filter((u) => u.role === r).length;
          return { value: r, label: r, sub: null, count: total, countLabel: total !== 1 ? "users" : "user", disabled: false, disabledLabel: null };
        });
      }
      case "profile": {
        const profiles = filters?.profiles ?? [];
        const allUsers = panelAllUsers.data?.users ?? usersData?.users ?? [];
        return profiles.map((p) => {
          const total = allUsers.filter((u) => u.profile === p).length;
          return { value: p, label: p, sub: null, count: total, countLabel: total !== 1 ? "users" : "user", disabled: false, disabledLabel: null };
        });
      }
      case "queue": {
        const qList = queues ?? [];
        return qList.map((q) => ({
          value: q.id,
          label: q.name,
          sub: null,
          count: q.memberCount ?? null,
          countLabel: "members",
          disabled: q.isLicensed ?? false,
          disabledLabel: "Already licensed",
        }));
      }
      case "custom": {
        // If no field selected yet, show available custom fields as options (step 1)
        if (!selectedCustomField) {
          const fields = customFields ?? [];
          return fields.map((f) => ({
            value: f.fieldApiName,
            label: f.fieldLabel || f.fieldApiName,
            sub: f.fieldType,
            count: null as number | null,
            countLabel: null as string | null,
            disabled: false,
            disabledLabel: null as string | null,
          }));
        }
        // Field is selected — show values for that field (step 2)
        const field = customFields?.find((f) => f.fieldApiName === selectedCustomField);
        if (field?.fieldType === "BOOLEAN") {
          return [
            { value: "true", label: "True", sub: null, count: null, countLabel: null, disabled: false, disabledLabel: null },
            { value: "false", label: "False", sub: null, count: null, countLabel: null, disabled: false, disabledLabel: null },
          ];
        }
        if (field?.fieldType === "PICKLIST" && field.picklistValues) {
          const vals = Array.isArray(field.picklistValues) ? field.picklistValues : [];
          return vals.map((v: string) => ({
            value: v, label: v, sub: null, count: null, countLabel: null, disabled: false, disabledLabel: null,
          }));
        }
        // For text/other fields, show empty — user types value in search input
        return [];
      }
      default:
        return [];
    }
  }, [activeMethod, panelAllUsers.data, filters, usersData, queues, customFields, selectedCustomField]);

  const filteredPanelOptions = useMemo(() => {
    if (!panelSearchQuery) return panelOptions;
    const q = panelSearchQuery.toLowerCase();
    return panelOptions.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sub && o.sub.toLowerCase().includes(q))
    );
  }, [panelOptions, panelSearchQuery]);

  // ── Match count for the selection panel preview ──
  const matchCount = useMemo(() => {
    if (!activeMethod || selectedValues.size === 0) return { newCount: 0, alreadyCount: 0 };
    const vals = [...selectedValues];

    if (activeMethod === "individual") {
      const allUsers = panelAllUsers.data?.users ?? [];
      const newCount = allUsers.filter((u) => vals.includes(u.id) && !u.isLicensed).length;
      return { newCount, alreadyCount: 0 };
    }
    if (activeMethod === "role") {
      const allUsers = panelAllUsers.data?.users ?? usersData?.users ?? [];
      const matched = allUsers.filter((u) => u.role && vals.includes(u.role));
      return {
        newCount: matched.filter((u) => !u.isLicensed).length,
        alreadyCount: matched.filter((u) => u.isLicensed).length,
      };
    }
    if (activeMethod === "profile") {
      const allUsers = panelAllUsers.data?.users ?? usersData?.users ?? [];
      const matched = allUsers.filter((u) => u.profile && vals.includes(u.profile));
      return {
        newCount: matched.filter((u) => !u.isLicensed).length,
        alreadyCount: matched.filter((u) => u.isLicensed).length,
      };
    }
    if (activeMethod === "queue") {
      return { newCount: vals.length, alreadyCount: 0 };
    }
    if (activeMethod === "custom") {
      // Custom field: need both a field selected and a value
      if (!selectedCustomField) return { newCount: 0, alreadyCount: 0 };
      const hasValue = vals.length > 0 || customFieldValue.length > 0;
      return { newCount: hasValue ? 1 : 0, alreadyCount: 0 };
    }
    return { newCount: 0, alreadyCount: 0 };
  }, [activeMethod, selectedValues, panelAllUsers.data, usersData]);

  // ── Method badge counts ──
  const methodBadgeCounts = useMemo(() => {
    const b = stats?.breakdown;
    return {
      individual: b?.individual ?? 0,
      role: b?.byRole ?? 0,
      profile: b?.byProfile ?? 0,
      queue: b?.licensedQueues ?? 0,
      custom: b?.byCustomField ?? 0,
    };
  }, [stats]);

  // ── Panel actions ──
  const closePanel = useCallback(() => {
    setActiveMethod(null);
    setSelectedValues(new Set());
    setPanelSearchQuery("");
    setDropdownOpen(false);
    setSelectedCustomField(null);
    setCustomFieldValue("");
  }, []);

  const selectMethod = useCallback((method: LicensingMethod) => {
    setHasAppliedMethod(true);
    if (activeMethod === method) {
      closePanel();
      return;
    }
    setActiveMethod(method);
    setSelectedValues(new Set());
    setPanelSearchQuery("");
    setDropdownOpen(false);
    setSelectedCustomField(null);
    setCustomFieldValue("");
    // Focus search after panel opens
    setTimeout(() => panelSearchRef.current?.focus(), 200);
  }, [activeMethod, closePanel]);

  const togglePanelValue = useCallback((value: string) => {
    // Custom field step 1: selecting a field transitions to step 2
    if (activeMethod === "custom" && !selectedCustomField) {
      setSelectedCustomField(value);
      setSelectedValues(new Set());
      setPanelSearchQuery("");
      setDropdownOpen(false);
      setTimeout(() => {
        panelSearchRef.current?.focus();
        setDropdownOpen(true);
      }, 100);
      return;
    }

    setSelectedValues((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
    setPanelSearchQuery("");
    panelSearchRef.current?.focus();
  }, [activeMethod, selectedCustomField]);

  const removePanelTag = useCallback((value: string) => {
    setSelectedValues((prev) => {
      const next = new Set(prev);
      next.delete(value);
      return next;
    });
  }, []);

  const applySelection = useCallback(() => {
    if (selectedValues.size === 0) return;
    const vals = [...selectedValues];
    setHasAppliedMethod(true);

    switch (activeMethod) {
      case "individual":
        licenseIndividualUsers.mutate(vals);
        break;
      case "role":
        licenseByRole.mutate(vals);
        break;
      case "profile":
        licenseByProfile.mutate(vals);
        break;
      case "queue":
        licenseQueues.mutate(vals);
        break;
      case "custom":
        if (selectedCustomField) {
          const fieldValue = vals.length > 0 ? vals[0] : customFieldValue || "true";
          licenseByCustomField.mutate({ fieldName: selectedCustomField, fieldValue });
        }
        break;
    }
  }, [activeMethod, selectedValues, licenseIndividualUsers, licenseByRole, licenseByProfile, licenseQueues, licenseByCustomField]);

  // ── Close dropdown on click outside ──
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Table row selection ──
  const users = usersData?.users ?? [];
  const totalUsers = usersData?.total ?? 0;
  const totalPages = usersData?.pages ?? 1;

  const allRowsSelected = users.length > 0 && users.every((u) => selectedRows.has(u.id));
  const someRowsSelected = users.some((u) => selectedRows.has(u.id));

  const toggleAllRows = useCallback(() => {
    if (allRowsSelected) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(users.map((u) => u.id)));
    }
  }, [allRowsSelected, users]);

  const toggleRow = useCallback((id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleUserLicense = useCallback((user: UserRecord) => {
    if (user.isLicensed) {
      deLicenseSingle.mutate(user.id);
    } else {
      licenseSingle.mutate(user.id);
    }
  }, [licenseSingle, deLicenseSingle]);

  // ── Seat gauge SVG helpers ──
  const seatsPurchased = stats?.seatsPurchased ?? 50;
  const seatsUsed = stats?.seatsUsed ?? 0;
  const seatPct = seatsPurchased > 0 ? seatsUsed / seatsPurchased : 0;
  const circumference = 2 * Math.PI * 54;
  const gaugeOffset = circumference * (1 - seatPct);
  const seatWarning = seatPct >= 0.9;

  // Auto-set hasAppliedMethod if there are already licensed users
  useEffect(() => {
    if (stats && stats.seatsUsed > 0) {
      setHasAppliedMethod(true);
    }
  }, [stats]);

  // ── License gating ──
  const isFreeTier = licenseData?.tier === "free";
  const maxSeats = licenseData?.limits?.maxSeats ?? -1; // -1 = unlimited
  const currentSeatsUsed = licenseData?.usage?.seats ?? 0;
  const isAtSeatLimit = isFreeTier && maxSeats > 0 && currentSeatsUsed >= maxSeats;

  // Determine whether to show the user table
  const hasActiveFilters = search || roleFilter !== "all" || profileFilter !== "all" || departmentFilter !== "all" || statusFilter !== "all";
  const showUserTable = hasAppliedMethod || hasActiveFilters;

  // ── Panel title/subtitle based on active method ──
  const panelConfig = useMemo(() => {
    switch (activeMethod) {
      case "individual":
        return { title: "Select Individual Users", subtitle: "Search for specific users to license", placeholder: "Search users by name or email..." };
      case "role":
        return { title: "Select Roles", subtitle: "All users with the selected roles will be licensed", placeholder: "Search roles..." };
      case "profile":
        return { title: "Select Profiles", subtitle: "All users with the selected profiles will be licensed", placeholder: "Search profiles..." };
      case "queue":
        return { title: "Select Queues", subtitle: "Selected queues will be licensed as routing targets", placeholder: "Search queues..." };
      case "custom":
        if (!selectedCustomField) {
          return { title: "Step 1: Select Custom Field", subtitle: "Choose a custom field on the User record", placeholder: "Search custom fields..." };
        }
        return { title: `Step 2: Select Value for ${selectedCustomField}`, subtitle: "Choose the value to match against", placeholder: "Search or enter a value..." };
      default:
        return { title: "", subtitle: "", placeholder: "" };
    }
  }, [activeMethod]);

  // ── Tag color for active method ──
  const activeTagColor = METHOD_CARDS.find((m) => m.key === activeMethod)?.tagColor ?? "";

  // ── Action button text ──
  const isQueue = activeMethod === "queue";
  const actionUnit = isQueue ? (matchCount.newCount !== 1 ? "Queues" : "Queue") : (matchCount.newCount !== 1 ? "Users" : "User");
  const applyBtnText = matchCount.newCount > 0
    ? `License ${matchCount.newCount} ${actionUnit}`
    : "License Matched";
  const applyDisabled = isAtSeatLimit || (activeMethod === "custom"
    ? !selectedCustomField || (selectedValues.size === 0 && !customFieldValue)
    : matchCount.newCount === 0);

  // Helper to get label for a selected value
  const getLabelForValue = useCallback((value: string) => {
    const opt = panelOptions.find((o) => o.value === value);
    return opt?.label ?? value;
  }, [panelOptions]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight font-display">License Users</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choose how to license Salesforce users for routing.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Button
            variant="outline"
            size="sm"
            disabled={syncUsers.isPending || syncQueuesM.isPending}
            onMouseDown={() => { syncUsers.mutate(); syncQueuesM.mutate(); }}
          >
            {syncUsers.isPending ? (
              <><Plug className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Syncing...</>
            ) : (
              <><Plug className="h-3.5 w-3.5 mr-1.5" /> Sync from Salesforce</>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onMouseDown={() => setShowAILicense(true)}
            className="border-violet-500/30 text-violet-600 hover:text-violet-700 hover:bg-violet-500/5 dark:text-violet-400 dark:hover:text-violet-300"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Use AI to License Users
            <Badge className="ml-1.5 bg-violet-600 text-[10px] px-1.5 py-0 text-white border-0">PRO</Badge>
          </Button>
          <Badge variant="outline" className="gap-1.5 text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950 border-sky-200 dark:border-sky-800">
            <Zap className="h-3 w-3" />
            Salesforce Connected
          </Badge>
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium",
              seatWarning
                ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400"
                : "border-border bg-background text-foreground"
            )}
          >
            <span className={cn("w-2 h-2 rounded-full shrink-0", seatWarning ? "bg-red-500 dark:bg-red-500" : "bg-green-500 dark:bg-green-500")} />
            {seatsUsed} / {seatsPurchased} seats
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="border-b">
        <div className="flex gap-0">
          <button
            onMouseDown={() => setActiveTab("users")}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === "users"
                ? "text-primary border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground"
            )}
          >
            Users
          </button>
          <button
            onMouseDown={() => setActiveTab("overview")}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === "overview"
                ? "text-primary border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground"
            )}
          >
            Overview
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════ */}
      {/* TAB 1: Users                                       */}
      {/* ═══════════════════════════════════════════════════ */}
      {activeTab === "users" && (
        <div className="space-y-5">
          {/* ── Upgrade banner (at or over seat limit on free tier) ── */}
          {isAtSeatLimit && (
            <div className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl border",
              currentSeatsUsed > maxSeats
                ? "border-red-300/40 dark:border-red-700/50 bg-red-50/80 dark:bg-red-950/40"
                : "border-amber-300/40 dark:border-amber-700/50 bg-amber-50/80 dark:bg-amber-950/40"
            )}>
              <AlertTriangle className={cn(
                "h-5 w-5 shrink-0",
                currentSeatsUsed > maxSeats
                  ? "text-red-500 dark:text-red-400"
                  : "text-amber-500 dark:text-amber-400"
              )} />
              <p className={cn(
                "text-sm flex-1",
                currentSeatsUsed > maxSeats
                  ? "text-red-800 dark:text-red-200"
                  : "text-amber-800 dark:text-amber-200"
              )}>
                {currentSeatsUsed > maxSeats
                  ? `You have ${currentSeatsUsed} licensed users but only ${maxSeats} seats on the Free plan. Please de-license ${currentSeatsUsed - maxSeats} user${currentSeatsUsed - maxSeats > 1 ? "s" : ""} or upgrade to Pro.`
                  : `You\u2019ve used all ${maxSeats} free licenses. Upgrade to Pro for unlimited licenses.`
                }
              </p>
              <a
                href="https://openedgeai.tech/pricing"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-flex items-center justify-center px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors shrink-0",
                  currentSeatsUsed > maxSeats
                    ? "bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400 text-white dark:text-red-950"
                    : "bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 text-white dark:text-amber-950"
                )}
              >
                Upgrade to Pro
              </a>
            </div>
          )}

          {/* ── Method selector cards ── */}
          <div className="grid grid-cols-5 gap-3">
            {METHOD_CARDS.map((card) => {
              const Icon = card.icon;
              const isSelected = activeMethod === card.key;
              const count = methodBadgeCounts[card.key];
              return (
                <button
                  key={card.key}
                  onMouseDown={() => selectMethod(card.key)}
                  className={cn(
                    "relative border-2 rounded-xl bg-background p-4 text-center transition-all duration-200 cursor-pointer",
                    isSelected
                      ? "border-primary bg-primary/5 shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
                      : "border-border hover:border-muted-foreground/30 hover:shadow-md hover:-translate-y-0.5"
                  )}
                >
                  {/* Badge count */}
                  {count > 0 && (
                    <span className="absolute top-2 right-2 min-w-5 h-5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center px-1.5">
                      {count}
                    </span>
                  )}
                  <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center mx-auto mb-2.5", card.iconBg)}>
                    <Icon className={cn("h-5 w-5", card.iconColor)} />
                  </div>
                  <div className="text-[13px] font-semibold">{card.label}</div>
                  <div className="text-[11.5px] text-muted-foreground mt-0.5">{card.description}</div>
                </button>
              );
            })}
          </div>

          {/* ── Selection panel ── */}
          <div
            className={cn(
              "grid transition-all duration-300",
              activeMethod
                ? "grid-rows-[1fr] opacity-100"
                : "grid-rows-[0fr] opacity-0"
            )}
          >
            <div className={cn(
              "overflow-hidden",
              activeMethod && "overflow-visible"
            )}>
            {activeMethod && (
              <div className="border rounded-xl bg-background p-5 mb-1">
              <>
                {/* Panel header */}
                <div className="flex items-center justify-between mb-3.5">
                  <div className="flex items-center gap-2">
                    {activeMethod === "custom" && selectedCustomField && (
                      <button
                        onMouseDown={() => { setSelectedCustomField(null); setSelectedValues(new Set()); setCustomFieldValue(""); setPanelSearchQuery(""); }}
                        className="text-xs text-primary hover:underline mr-2"
                      >
                        ← Back to fields
                      </button>
                    )}
                    <div>
                      <div className="text-sm font-semibold">{panelConfig.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{panelConfig.subtitle}</div>
                    </div>
                  </div>
                </div>

                {/* Custom field text input for non-picklist/non-boolean fields (step 2) */}
                {activeMethod === "custom" && selectedCustomField && panelOptions.length === 0 && (
                  <div className="mb-3">
                    <Input
                      placeholder={`Enter value for ${selectedCustomField}...`}
                      value={customFieldValue}
                      onChange={(e) => setCustomFieldValue(e.target.value)}
                      className="text-sm"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Users where {selectedCustomField} matches this value will be licensed.</p>
                  </div>
                )}

                {/* Searchable dropdown */}
                <div ref={dropdownRef} className="relative mb-1">
                  {/* Input wrap with tags */}
                  <div
                    onMouseDown={() => panelSearchRef.current?.focus()}
                    className={cn(
                      "flex items-center flex-wrap gap-1.5 min-h-[40px] px-2.5 py-1.5 border rounded-lg bg-background cursor-text transition-all shadow-sm",
                      dropdownOpen && "border-primary ring-[3px] ring-primary/10"
                    )}
                  >
                    {/* Selected tags */}
                    {[...selectedValues].map((val) => (
                      <span
                        key={val}
                        className={cn(
                          "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium border animate-in fade-in zoom-in-95 duration-150",
                          activeTagColor
                        )}
                      >
                        {getLabelForValue(val)}
                        <button
                          onMouseDown={(e) => { e.stopPropagation(); removePanelTag(val); }}
                          className="inline-flex items-center justify-center w-4 h-4 rounded opacity-60 hover:opacity-100 hover:bg-black/5"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                    <input
                      ref={panelSearchRef}
                      type="text"
                      className="flex-1 min-w-[120px] h-7 border-0 outline-none bg-transparent text-sm placeholder:text-muted-foreground"
                      placeholder={selectedValues.size === 0 ? panelConfig.placeholder : "Search..."}
                      value={panelSearchQuery}
                      onChange={(e) => setPanelSearchQuery(e.target.value)}
                      onFocus={() => setDropdownOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { setDropdownOpen(false); e.preventDefault(); }
                        if (e.key === "Backspace" && !panelSearchQuery && selectedValues.size > 0) {
                          const last = [...selectedValues].pop();
                          if (last) removePanelTag(last);
                        }
                      }}
                      autoComplete="off"
                    />
                  </div>

                  {/* Dropdown list */}
                  {dropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 max-h-60 overflow-y-auto z-20 border rounded-lg bg-background shadow-md animate-in fade-in slide-in-from-top-1 duration-100">
                      {filteredPanelOptions.length === 0 ? (
                        <div className="py-4 text-center text-sm text-muted-foreground">
                          No matches found
                        </div>
                      ) : (
                        filteredPanelOptions.map((opt) => {
                          const isOpted = selectedValues.has(opt.value);
                          const isDisabled = opt.disabled && !isOpted;
                          return (
                            <div
                              key={opt.value}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                if (!isDisabled) togglePanelValue(opt.value);
                              }}
                              className={cn(
                                "flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer transition-colors text-sm",
                                isOpted && "bg-primary/5",
                                isDisabled && "opacity-50 cursor-default",
                                !isOpted && !isDisabled && "hover:bg-muted"
                              )}
                            >
                              <div className={cn(
                                "w-4 h-4 rounded border-[1.5px] flex items-center justify-center shrink-0 transition-all",
                                isOpted ? "bg-primary border-primary" : "border-muted-foreground/30 bg-background"
                              )}>
                                {isOpted && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                              </div>
                              <span className="flex-1 min-w-0">
                                <span className="font-medium">{highlightMatch(opt.label, panelSearchQuery)}</span>
                                {opt.sub && (
                                  <span className="ml-1.5 text-xs text-muted-foreground font-mono">
                                    {highlightMatch(opt.sub, panelSearchQuery)}
                                  </span>
                                )}
                              </span>
                              {isDisabled && opt.disabledLabel && (
                                <span className="text-[11px] text-muted-foreground italic">{opt.disabledLabel}</span>
                              )}
                              {opt.count != null && (
                                <span className="text-xs text-muted-foreground font-medium">
                                  {opt.count} {opt.countLabel ?? "users"}
                                </span>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {/* Match preview + actions */}
                <div className="flex items-center gap-2 mt-3.5 pt-3.5 border-t">
                  <div className="text-sm text-muted-foreground flex-1">
                    {selectedValues.size === 0 ? (
                      "Select values above to see how many will be licensed"
                    ) : (
                      <>
                        <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold mr-1">
                          {matchCount.newCount}
                        </span>
                        {isQueue ? (matchCount.newCount !== 1 ? " queues" : " queue") : (matchCount.newCount !== 1 ? " users" : " user")} will be licensed
                        {matchCount.alreadyCount > 0 && (
                          <span className="ml-2 text-muted-foreground/70">
                            · {matchCount.alreadyCount} already licensed
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onMouseDown={applySelection}
                    disabled={applyDisabled || licenseByRole.isPending || licenseByProfile.isPending || licenseQueues.isPending || licenseIndividualUsers.isPending || licenseByCustomField.isPending}
                  >
                    {applyBtnText}
                  </Button>
                  <Button variant="ghost" size="sm" onMouseDown={closePanel}>
                    Cancel
                  </Button>
                </div>
              </>
            </div>
            )}
            </div>
          </div>

          {/* ── Filter bar ── */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name, email, role..."
                className="pl-8 h-9"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); setHasAppliedMethod(true); }}
              />
            </div>
            <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {(filters?.roles ?? []).map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={profileFilter} onValueChange={(v) => { setProfileFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue placeholder="All Profiles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Profiles</SelectItem>
                {(filters?.profiles ?? []).map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={departmentFilter} onValueChange={(v) => { setDepartmentFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {(filters?.departments ?? []).map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="licensed">Licensed</SelectItem>
                <SelectItem value="unlicensed">Unlicensed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* ── User table ── */}
          {!showUserTable ? (
            <div className="border rounded-xl bg-background p-12 text-center shadow-sm">
              <Users className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                Select a licensing method above to view and license users.
              </p>
            </div>
          ) : usersLoading ? (
            <TableSkeleton />
          ) : (
            <div className="border rounded-xl overflow-hidden bg-background shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="w-[42px] pr-0">
                      <Checkbox
                        checked={allRowsSelected ? true : someRowsSelected ? "indeterminate" : false}
                        onCheckedChange={toggleAllRows}
                      />
                    </TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Role / Profile</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Teams</TableHead>
                    <TableHead>Last Routed</TableHead>
                    <TableHead className="text-right">Licensed</TableHead>
                    <TableHead className="w-12 text-center" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                        <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                        No users match your filters
                      </TableCell>
                    </TableRow>
                  ) : (
                    users.map((user) => (
                      <TableRow
                        key={user.id}
                        className={cn(selectedRows.has(user.id) && "bg-primary/5")}
                      >
                        <TableCell className="pr-0">
                          <Checkbox
                            checked={selectedRows.has(user.id)}
                            onCheckedChange={() => toggleRow(user.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{user.name}</div>
                          <div className="text-xs text-muted-foreground font-mono mt-0.5">{user.email}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{user.role ?? "—"}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{user.profile ?? ""}</div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{user.department ?? "—"}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {user.teamMemberships && user.teamMemberships.length > 0 ? (
                              user.teamMemberships.map((tm) => (
                                <span
                                  key={tm.team.id}
                                  className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted border text-[11.5px] font-medium text-muted-foreground"
                                >
                                  {tm.team.name}
                                </span>
                              ))
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={cn("text-sm", !user.lastRoutedAt && "text-muted-foreground/50")}>
                            {formatRelativeTime(user.lastRoutedAt)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <Badge
                              variant={user.isLicensed ? "default" : "outline"}
                              className={cn(
                                "min-w-[76px] justify-center",
                                user.isLicensed && "bg-primary"
                              )}
                            >
                              {user.isLicensed ? "Licensed" : "Unlicensed"}
                            </Badge>
                            <Switch
                              checked={user.isLicensed}
                              onCheckedChange={() => toggleUserLicense(user)}
                              disabled={licenseSingle.isPending || deLicenseSingle.isPending || (!user.isLicensed && isAtSeatLimit)}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <button
                            onMouseDown={() => {
                              if (confirm(`Remove ${user.name}? This cannot be undone.`)) {
                                deleteUser.mutate(user.id);
                              }
                            }}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
                  <span>
                    Showing {users.length} of {totalUsers} users · Page {page} of {totalPages}
                  </span>
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onMouseDown={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onMouseDown={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/* TAB 2: Overview                                     */}
      {/* ═══════════════════════════════════════════════════ */}
      {activeTab === "overview" && (
        <div className="space-y-5">
          {/* ── Seat usage gauge ── */}
          <div className="border rounded-xl bg-background p-6 shadow-sm">
            <h3 className="text-[15px] font-semibold mb-4">Seat Usage</h3>
            <div className="flex items-center gap-8">
              <svg width="130" height="130" viewBox="0 0 130 130">
                <circle cx="65" cy="65" r="54" fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/30" />
                <circle
                  cx="65" cy="65" r="54"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={gaugeOffset}
                  transform="rotate(-90 65 65)"
                  className="text-primary transition-[stroke-dashoffset] duration-1000 ease-out"
                />
                <text x="65" y="58" textAnchor="middle" className="fill-foreground text-[28px] font-bold font-display" fontFamily="inherit">
                  {seatsUsed}
                </text>
                <text x="65" y="74" textAnchor="middle" className="fill-muted-foreground text-[13px] font-medium" fontFamily="inherit">
                  /{seatsPurchased}
                </text>
                <text x="65" y="92" textAnchor="middle" className="fill-muted-foreground text-[11px] font-medium" fontFamily="inherit">
                  {Math.round(seatPct * 100)}% used
                </text>
              </svg>
              <div className="flex-1">
                <p className="text-[15px] text-muted-foreground leading-relaxed">
                  You have <strong className="text-foreground">{seatsPurchased - seatsUsed}</strong> seats remaining on the <strong className="text-foreground">Paid</strong> plan.
                </p>
                <a href="#" className="text-primary font-medium text-sm hover:underline">
                  Upgrade plan &rarr;
                </a>
              </div>
            </div>
          </div>

          {/* ── Breakdown by method ── */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { key: "individual" as const, label: "Individual Users", color: "border-l-blue-600" },
              { key: "role" as const, label: "By Role", color: "border-l-purple-500" },
              { key: "profile" as const, label: "By Profile", color: "border-l-teal-500" },
              { key: "queue" as const, label: "Queues Licensed", color: "border-l-orange-500" },
              { key: "custom" as const, label: "By Custom Field", color: "border-l-green-500" },
            ].map((stat, i) => (
              <div
                key={stat.key}
                className={cn(
                  "border border-l-[3px] rounded-xl bg-background p-4 shadow-sm",
                  stat.color
                )}
                style={{ animationDelay: `${i * 0.08}s` }}
              >
                <div className="text-[22px] font-bold tracking-tight font-display">{methodBadgeCounts[stat.key]}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* ── Active licensing methods table ── */}
          <div className="border rounded-xl bg-background p-6 shadow-sm">
            <h3 className="text-[15px] font-semibold mb-4">Active Licensing Methods</h3>
            <table className="w-full">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 text-xs font-medium text-muted-foreground">Method</th>
                  <th className="pb-2 text-xs font-medium text-muted-foreground">Count</th>
                  <th className="pb-2 text-xs font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { key: "individual" as const, label: "Individual Users", pillClass: "bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300" },
                  { key: "role" as const, label: "By Role", pillClass: "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300" },
                  { key: "profile" as const, label: "By Profile", pillClass: "bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300" },
                  { key: "queue" as const, label: "By Queue", pillClass: "bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300" },
                  { key: "custom" as const, label: "By Custom Field", pillClass: "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300" },
                ].filter((m) => methodBadgeCounts[m.key] > 0).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center text-muted-foreground py-6 text-sm">
                      No active licensing methods
                    </td>
                  </tr>
                ) : (
                  [
                    { key: "individual" as const, label: "Individual Users", pillClass: "bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300" },
                    { key: "role" as const, label: "By Role", pillClass: "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300" },
                    { key: "profile" as const, label: "By Profile", pillClass: "bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300" },
                    { key: "queue" as const, label: "By Queue", pillClass: "bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300" },
                    { key: "custom" as const, label: "By Custom Field", pillClass: "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300" },
                  ]
                    .filter((m) => methodBadgeCounts[m.key] > 0)
                    .map((m) => (
                      <tr key={m.key} className="border-b last:border-0">
                        <td className="py-2.5">
                          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium", m.pillClass)}>
                            {m.label}
                          </span>
                        </td>
                        <td className="py-2.5 text-sm">
                          <strong>{methodBadgeCounts[m.key]}</strong>
                        </td>
                        <td className="py-2.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 text-[11.5px] font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 dark:bg-green-500" />
                            Active
                          </span>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>

          {/* ── Recent activity timeline ── */}
          <div className="border rounded-xl bg-background p-6 shadow-sm">
            <h3 className="text-[15px] font-semibold mb-4">Recent Activity</h3>
            <div className="relative pl-6">
              {/* Vertical line */}
              <div className="absolute left-[6px] top-1 bottom-1 w-0.5 bg-border rounded-full" />

              {[
                { color: "border-blue-500 dark:border-blue-400 after:bg-blue-500 dark:after:bg-blue-400", text: "Licensing rules updated", time: "Recently" },
                { color: "border-green-500 dark:border-green-400 after:bg-green-500 dark:after:bg-green-400", text: "Users synced from Salesforce", time: "Earlier today" },
                { color: "border-amber-500 dark:border-amber-400 after:bg-amber-500 dark:after:bg-amber-400", text: "Seat allocation reviewed", time: "This week" },
              ].map((item, i) => (
                <div key={i} className="relative pb-5 last:pb-0">
                  <div
                    className={cn(
                      "absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-background border-2",
                      item.color.split(" ")[0]
                    )}
                  >
                    <div className={cn("absolute top-[2px] left-[2px] w-1.5 h-1.5 rounded-full", item.color.split(" ")[1]?.replace("after:", ""))} />
                  </div>
                  <div className="text-sm">{item.text}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{item.time}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk action bar ── */}
      {selectedRows.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-background border rounded-xl px-3.5 py-2.5 shadow-lg z-50 animate-in slide-in-from-bottom-2 fade-in duration-200">
          <span className="text-sm font-medium pr-1">{selectedRows.size} selected</span>
          <div className="w-px h-5 bg-border mx-0.5" />
          <Button
            size="sm"
            onMouseDown={() => bulkLicense.mutate({ userIds: [...selectedRows], action: "license" })}
            disabled={bulkLicense.isPending}
          >
            License Selected
          </Button>
          <Button
            variant="outline"
            size="sm"
            onMouseDown={() => bulkLicense.mutate({ userIds: [...selectedRows], action: "de-license" })}
            disabled={bulkLicense.isPending}
          >
            De-License Selected
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950"
            onMouseDown={() => {
              if (confirm(`Delete ${selectedRows.size} selected users? This cannot be undone.`)) {
                bulkDelete.mutate([...selectedRows]);
              }
            }}
            disabled={bulkDelete.isPending}
          >
            Delete Selected
          </Button>
          <div className="w-px h-5 bg-border mx-0.5" />
          <Button variant="ghost" size="sm" onMouseDown={() => setSelectedRows(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* ── AI License Panel ── */}
      {showAILicense && (
        <AgentChatPanel
          context="license-users"
          onMutationComplete={() => { invalidateAll(); }}
          onClose={() => setShowAILicense(false)}
        />
      )}
    </div>
  );
}

// ─── Highlight helper (outside component to avoid re-creation) ────────────────

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 text-inherit rounded-sm px-px">{part}</mark>
    ) : (
      part
    )
  );
}
