"use client";

import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { hasPermission } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  createOperator,
  createRole,
  deleteMasterOperator,
  deleteRole,
  getMasterOperators,
  getRoleRecords,
  setRolePermissions,
  updateMasterOperator,
  updateRole,
} from "@/lib/gateways/master-operator";
import { getScanSecurity } from "@/lib/gateways/scan-security";
import { adminDisableTwoFactor } from "@/lib/gateways/two-factor";
import { useDebounce } from "@/lib/hooks/useDebounce";
import type { OperatorDraft, OperatorRecord } from "@/lib/operators/types";
import {
  PERMISSION_CATALOG,
  type PermissionKey,
  SUPERADMIN_ONLY_PERMISSIONS,
} from "@/lib/rbac/catalog";
import type { RoleRecord } from "@/lib/rbac/types";

/*
 * Cerminan Mobile dari `web-desktop/src/app/operators/page.tsx`. Logikanya
 * sengaja identik — gateway, guard Superadmin, kunci role Superadmin, dan
 * peringatan sakelar foto/IP — hanya tata letaknya yang diubah menjadi kartu
 * agar nyaman di layar sentuh. Biner Mobile sudah mendaftarkan seluruh command
 * `desktop_*` operator & role yang dipanggil gateway ini.
 */

type ActiveTab = "operators" | "roles";
type Tone = "success" | "info" | "warning" | "neutral" | "danger";

const EMPTY_OPERATOR: OperatorDraft = {
  kodeOperator: "",
  name: "",
  username: "",
  email: "",
  noHp: "",
  password: "",
  roleId: 0,
  status: "Aktif",
};

const EDITABLE_PERMISSION_GROUPS = PERMISSION_CATALOG.filter(
  ({ key }) => !SUPERADMIN_ONLY_PERMISSIONS.has(key),
).reduce<Record<string, (typeof PERMISSION_CATALOG)[number][]>>(
  (groups, permission) => {
    groups[permission.group] = [
      ...(groups[permission.group] ?? []),
      permission,
    ];
    return groups;
  },
  {},
);

interface RoleFormState {
  name: string;
  description: string;
  status: "Aktif" | "Nonaktif";
  requireTotp: boolean;
  requireScanPhoto: boolean;
  requireScanIpAllowlist: boolean;
}

const EMPTY_ROLE: RoleFormState = {
  name: "",
  description: "",
  status: "Aktif",
  requireTotp: false,
  requireScanPhoto: false,
  requireScanIpAllowlist: false,
};

const INPUT_CLASS =
  "min-h-11 w-full rounded-xl border border-white/15 bg-slate-950 px-3 text-xs text-white outline-none transition focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60";

const PILL_TONES: Record<Tone, string> = {
  success: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  info: "border-sky-500/40 bg-sky-500/15 text-sky-300",
  warning: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  neutral: "border-white/15 bg-slate-500/15 text-slate-300",
  danger: "border-rose-500/40 bg-rose-500/15 text-rose-300",
};

function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Operasi tidak dapat diselesaikan.";
  if (error.message.includes("UNIQUE")) {
    return "Kode operator, username, atau nama role sudah digunakan.";
  }
  return error.message;
}

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export default function MobileMasterOperatorPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>("operators");
  const [operators, setOperators] = useState<OperatorRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // State `saving` baru terbaca pada render berikutnya, jadi dua ketukan dalam
  // satu tick sama-sama lolos. Ref berubah seketika.
  const isSubmittingRef = useRef(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [operatorModal, setOperatorModal] = useState(false);
  const [editingOperator, setEditingOperator] = useState<OperatorRecord | null>(
    null,
  );
  const [operatorDraft, setOperatorDraft] =
    useState<OperatorDraft>(EMPTY_OPERATOR);
  const [roleModal, setRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRecord | null>(null);
  const [roleDraft, setRoleDraft] = useState<RoleFormState>(EMPTY_ROLE);
  const [selectedPermissions, setSelectedPermissions] = useState<
    Set<PermissionKey>
  >(new Set());
  const [deleteTarget, setDeleteTarget] = useState<
    | { type: "operator"; item: OperatorRecord }
    | { type: "role"; item: RoleRecord }
    | null
  >(null);
  // Sakelar per role hanya berlaku bila fiturnya dihidupkan di Pengaturan.
  // Tanpa penanda ini, Superadmin akan menyalakan sakelar role dan mengira
  // absensi sudah dijaga padahal fiturnya mati.
  const [scanSecurity, setScanSecurity] = useState({
    photoEnabled: false,
    ipRestrictionEnabled: false,
  });

  const isSuperadmin = Boolean(user?.isSuperadmin);
  const canResetTwoFactor = hasPermission(user, "two_factor.reset");

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
      return;
    }
    // Sama seperti Web/Desktop: hanya Superadmin. Mobile tidak punya rute
    // `/forbidden`, jadi pengguna lain dipulangkan ke Pengaturan.
    if (!authLoading && isAuthenticated && !isSuperadmin) {
      router.replace("/settings");
    }
  }, [authLoading, isAuthenticated, isSuperadmin, router]);

  const loadData = useCallback(
    async (silent = false) => {
      if (!user?.isSuperadmin) return;
      if (!silent) setLoading(true);
      try {
        const [operatorData, roleData, security] = await Promise.all([
          getMasterOperators(user.id),
          getRoleRecords(user.id),
          getScanSecurity(),
        ]);
        setOperators(operatorData);
        setRoles(roleData);
        setScanSecurity({
          photoEnabled: security.photoEnabled,
          ipRestrictionEnabled: security.ipRestrictionEnabled,
        });
      } catch (error) {
        if (!silent) {
          setFeedback({ type: "error", message: errorMessage(error) });
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [user],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const onSyncCompleted = () => {
      void loadData(true);
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [loadData]);

  const filteredOperators = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return operators;
    return operators.filter((operator) =>
      [
        operator.name,
        operator.kodeOperator,
        operator.username,
        operator.email,
        operator.noHp,
        operator.roleName,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [operators, debouncedSearch]);

  const openNewOperator = () => {
    triggerHaptic("light");
    const firstRole =
      roles.find((role) => role.status === "Aktif" && !role.isSuperadmin) ??
      roles.find((role) => role.status === "Aktif");
    setEditingOperator(null);
    setOperatorDraft({ ...EMPTY_OPERATOR, roleId: firstRole?.id ?? 0 });
    setOperatorModal(true);
  };

  const openEditOperator = (operator: OperatorRecord) => {
    triggerHaptic("light");
    setEditingOperator(operator);
    setOperatorDraft({
      kodeOperator: operator.kodeOperator,
      name: operator.name,
      username: operator.username,
      email: operator.email,
      noHp: operator.noHp,
      password: "",
      roleId: operator.roleId,
      status: operator.status,
    });
    setOperatorModal(true);
  };

  const submitOperator = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      if (editingOperator) {
        await updateMasterOperator(user.id, editingOperator.id, operatorDraft);
      } else {
        await createOperator(user.id, operatorDraft);
      }
      triggerHaptic("success");
      setOperatorModal(false);
      await loadData();
      setFeedback({
        type: "success",
        message: editingOperator
          ? "Operator berhasil diperbarui."
          : "Operator berhasil ditambahkan.",
      });
    } catch (error) {
      triggerHaptic("error");
      setFeedback({ type: "error", message: errorMessage(error) });
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  const resetOperatorTwoFactor = async (operator: OperatorRecord) => {
    if (!user || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      await adminDisableTwoFactor(operator.id);
      triggerHaptic("success");
      setFeedback({
        type: "success",
        message: `Verifikasi dua langkah ${operator.name} dimatikan. Minta yang bersangkutan mengaktifkannya lagi dari Pengaturan.`,
      });
      await loadData();
    } catch (error) {
      triggerHaptic("error");
      setFeedback({ type: "error", message: errorMessage(error) });
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  const openNewRole = () => {
    triggerHaptic("light");
    setEditingRole(null);
    setRoleDraft(EMPTY_ROLE);
    setSelectedPermissions(new Set());
    setRoleModal(true);
  };

  const openEditRole = (role: RoleRecord) => {
    triggerHaptic("light");
    setEditingRole(role);
    setRoleDraft({
      name: role.name,
      description: role.description,
      status: role.status,
      requireTotp: role.requireTotp,
      requireScanPhoto: role.requireScanPhoto,
      requireScanIpAllowlist: role.requireScanIpAllowlist,
    });
    setSelectedPermissions(new Set(role.permissions));
    setRoleModal(true);
  };

  const submitRole = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      if (editingRole) {
        await updateRole(user.id, editingRole.id, roleDraft, {
          isSuperadmin: editingRole.isSuperadmin,
        });
        // Permission Superadmin selalu penuh dan ditolak backend bila dikirim.
        if (!editingRole.isSuperadmin) {
          await setRolePermissions(user.id, editingRole.id, [
            ...selectedPermissions,
          ]);
        }
      } else {
        await createRole(user.id, roleDraft, [...selectedPermissions]);
      }
      triggerHaptic("success");
      setRoleModal(false);
      await loadData();
      setFeedback({
        type: "success",
        message: editingRole
          ? "Role dan permission berhasil diperbarui."
          : "Role baru berhasil dibuat.",
      });
    } catch (error) {
      triggerHaptic("error");
      setFeedback({ type: "error", message: errorMessage(error) });
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!user || !deleteTarget || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      if (deleteTarget.type === "operator") {
        await deleteMasterOperator(user.id, deleteTarget.item.id);
      } else {
        await deleteRole(user.id, deleteTarget.item.id);
      }
      triggerHaptic("success");
      setDeleteTarget(null);
      await loadData();
      setFeedback({ type: "success", message: "Data berhasil dihapus." });
    } catch (error) {
      triggerHaptic("error");
      setDeleteTarget(null);
      setFeedback({ type: "error", message: errorMessage(error) });
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  if (authLoading || !isAuthenticated || !isSuperadmin) {
    return <div className="min-h-dvh bg-slate-950" />;
  }

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-4 text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                router.push("/settings");
              }}
              aria-label="Kembali ke Pengaturan"
              className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/5 text-slate-300 transition hover:bg-white/10 active:scale-95"
            >
              <Icon name="arrow-left" className="size-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-black tracking-tight text-white">
                Master Operator
              </h1>
              <p className="text-[11px] text-slate-400">
                Akun, role dinamis &amp; permission
              </p>
            </div>
          </div>
          <Pill tone="warning">
            <Icon name="lock" className="size-3" />
            Superadmin
          </Pill>
        </div>

        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onClose={() => setFeedback(null)}
          />
        ) : null}

        {/* Tabs & Primary Action */}
        <div className="rounded-3xl border border-white/15 bg-slate-900/90 p-3 shadow-xl">
          <div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-slate-950/80 p-1">
            {(["operators", "roles"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  triggerHaptic("light");
                  setActiveTab(tab);
                }}
                className={`min-h-11 rounded-xl px-2 text-xs font-bold transition active:scale-95 ${
                  activeTab === tab
                    ? "bg-sky-500 text-slate-950 shadow-md"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {tab === "operators"
                  ? `Pengguna (${operators.length})`
                  : `Role & Akses (${roles.length})`}
              </button>
            ))}
          </div>

          {activeTab === "operators" ? (
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari nama, kode, username, email..."
              aria-label="Cari operator"
              className="mt-3 min-h-11 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3.5 text-xs text-white placeholder-slate-500 outline-none focus:border-sky-400"
            />
          ) : null}

          <button
            type="button"
            onClick={activeTab === "operators" ? openNewOperator : openNewRole}
            disabled={loading}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-300 text-xs font-black text-slate-950 shadow-md transition hover:bg-amber-200 active:scale-95 disabled:opacity-50"
          >
            <Icon name="plus" className="size-4" />
            {activeTab === "operators" ? "Tambah operator" : "Buat role baru"}
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-2xl border border-white/5 bg-slate-900/40"
              />
            ))}
          </div>
        ) : activeTab === "operators" ? (
          filteredOperators.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-8 text-center text-xs text-slate-500">
              {search
                ? "Tidak ada operator yang cocok dengan pencarian."
                : "Belum ada operator."}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredOperators.map((operator) => (
                <OperatorCard
                  key={operator.id}
                  operator={operator}
                  isCurrentUser={operator.id === user?.id}
                  saving={saving}
                  canResetTwoFactor={canResetTwoFactor}
                  onEdit={openEditOperator}
                  onResetTwoFactor={(item) => void resetOperatorTwoFactor(item)}
                  onDelete={(item) => {
                    triggerHaptic("warning");
                    setDeleteTarget({ type: "operator", item });
                  }}
                />
              ))}
            </div>
          )
        ) : roles.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-8 text-center text-xs text-slate-500">
            Belum ada role.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {roles.map((role) => (
              <RoleCard
                key={role.id}
                role={role}
                onEdit={openEditRole}
                onDelete={(item) => {
                  triggerHaptic("warning");
                  setDeleteTarget({ type: "role", item });
                }}
              />
            ))}
          </div>
        )}
      </div>

      <OperatorFormModal
        isOpen={operatorModal}
        editingOperator={editingOperator}
        draft={operatorDraft}
        roles={roles}
        saving={saving}
        onChange={setOperatorDraft}
        onClose={() => {
          if (!saving) setOperatorModal(false);
        }}
        onSubmit={submitOperator}
      />

      <RoleFormModal
        isOpen={roleModal}
        editingRole={editingRole}
        scanSecurity={scanSecurity}
        draft={roleDraft}
        permissions={selectedPermissions}
        saving={saving}
        onDraftChange={setRoleDraft}
        onPermissionsChange={setSelectedPermissions}
        onClose={() => {
          if (!saving) setRoleModal(false);
        }}
        onSubmit={submitRole}
      />

      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => {
          if (!saving) setDeleteTarget(null);
        }}
        title="Konfirmasi penghapusan"
        titleId="operator-delete-modal-title"
        maxWidth="max-w-sm"
        hideFooter
      >
        {deleteTarget ? (
          <div className="flex flex-col gap-4 text-xs">
            <div className="rounded-2xl border border-rose-500/20 bg-rose-950/30 p-3.5">
              <p className="text-sm leading-6 text-slate-300">
                Hapus {deleteTarget.type === "operator" ? "operator" : "role"}{" "}
                <strong className="text-white">{deleteTarget.item.name}</strong>
                ?
              </p>
              <p className="mt-1 text-[11px] leading-4 text-slate-400">
                Data dengan histori transaksi akan ditolak dan harus
                dinonaktifkan.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setDeleteTarget(null)}
                className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-300 transition hover:bg-white/10 active:scale-95 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void confirmDelete()}
                className="min-h-11 flex-1 rounded-xl bg-rose-500 text-xs font-black text-on-accent shadow-lg transition hover:bg-rose-600 active:scale-95 disabled:opacity-50"
              >
                {saving ? "Menghapus..." : "Hapus"}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </MobileAppShell>
  );
}

function OperatorCard({
  operator,
  isCurrentUser,
  saving,
  canResetTwoFactor,
  onEdit,
  onResetTwoFactor,
  onDelete,
}: {
  operator: OperatorRecord;
  isCurrentUser: boolean;
  saving: boolean;
  canResetTwoFactor: boolean;
  onEdit: (operator: OperatorRecord) => void;
  onResetTwoFactor: (operator: OperatorRecord) => void;
  onDelete: (operator: OperatorRecord) => void;
}) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/80 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">
            {operator.name}
          </p>
          <p className="truncate font-mono text-[11px] text-slate-400">
            {operator.kodeOperator} · @{operator.username}
          </p>
          {isCurrentUser ? (
            <span className="text-[10px] font-bold text-sky-300">
              Akun aktif
            </span>
          ) : null}
        </div>
        <Pill tone={operator.status === "Aktif" ? "success" : "neutral"}>
          {operator.status}
        </Pill>
      </div>

      <div className="space-y-0.5 rounded-xl border border-white/5 bg-slate-950/60 p-2.5 text-[11px] text-slate-400">
        <p className="truncate">{operator.email || "Email belum diisi"}</p>
        <p className="truncate">{operator.noHp || "Nomor HP belum diisi"}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Pill tone={operator.isSuperadmin ? "warning" : "info"}>
          {operator.roleName}
        </Pill>
        <Pill tone={operator.totpEnabled ? "success" : "neutral"}>
          2FA {operator.totpEnabled ? "Aktif" : "Mati"}
        </Pill>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onEdit(operator)}
          className="min-h-11 flex-1 rounded-xl border border-sky-300/20 bg-sky-300/10 text-xs font-bold text-sky-200 transition active:scale-95"
        >
          Edit
        </button>
        {canResetTwoFactor && operator.totpEnabled ? (
          <button
            type="button"
            onClick={() => onResetTwoFactor(operator)}
            disabled={saving}
            title="Matikan verifikasi dua langkah operator ini"
            className="min-h-11 flex-1 rounded-xl border border-violet-300/20 bg-violet-300/10 text-xs font-bold text-violet-200 transition active:scale-95 disabled:opacity-40"
          >
            Reset 2FA
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onDelete(operator)}
          disabled={isCurrentUser}
          className="min-h-11 flex-1 rounded-xl border border-rose-300/20 bg-rose-300/10 text-xs font-bold text-rose-200 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Hapus
        </button>
      </div>
    </article>
  );
}

function RoleCard({
  role,
  onEdit,
  onDelete,
}: {
  role: RoleRecord;
  onEdit: (role: RoleRecord) => void;
  onDelete: (role: RoleRecord) => void;
}) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/80 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="text-sm font-black text-white">{role.name}</h2>
            {role.isSystem ? <Pill tone="neutral">Sistem</Pill> : null}
          </div>
          <p className="mt-0.5 font-mono text-[10px] text-slate-500">
            {role.roleKey}
          </p>
        </div>
        <Pill tone={role.status === "Aktif" ? "success" : "neutral"}>
          {role.status}
        </Pill>
      </div>

      <p className="text-xs leading-5 text-slate-400">
        {role.description || "Belum ada deskripsi role."}
      </p>

      {role.requireTotp ||
      role.requireScanPhoto ||
      role.requireScanIpAllowlist ? (
        <div className="flex flex-wrap gap-1.5">
          {role.requireTotp ? <Pill tone="info">Wajib 2FA</Pill> : null}
          {role.requireScanPhoto ? (
            <Pill tone="info">Wajib foto absensi</Pill>
          ) : null}
          {role.requireScanIpAllowlist ? (
            <Pill tone="info">Absensi dibatasi IP</Pill>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/5 bg-slate-950/60 p-2.5 text-center">
        <div>
          <p className="text-base font-black text-white">
            {role.operatorCount}
          </p>
          <p className="text-[10px] text-slate-500">Operator</p>
        </div>
        <div>
          <p className="text-base font-black text-sky-200">
            {role.isSuperadmin ? "Semua" : role.permissions.length}
          </p>
          <p className="text-[10px] text-slate-500">Permission</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onEdit(role)}
          className="min-h-11 flex-1 rounded-xl bg-sky-400/10 text-xs font-black text-sky-200 transition active:scale-95"
        >
          {role.isSuperadmin ? "Lihat" : "Atur akses"}
        </button>
        {!role.isSystem ? (
          <button
            type="button"
            onClick={() => onDelete(role)}
            className="min-h-11 rounded-xl bg-rose-400/10 px-4 text-xs font-black text-rose-200 transition active:scale-95"
          >
            Hapus
          </button>
        ) : null}
      </div>
    </article>
  );
}

function OperatorFormModal({
  isOpen,
  editingOperator,
  draft,
  roles,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  editingOperator: OperatorRecord | null;
  draft: OperatorDraft;
  roles: RoleRecord[];
  saving: boolean;
  onChange: (draft: OperatorDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingOperator ? "Edit operator" : "Tambah operator"}
      titleId="operator-modal-title"
      maxWidth="max-w-md"
      hideFooter
    >
      <form className="space-y-3.5 text-xs" onSubmit={onSubmit}>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Kode operator" htmlFor="operator-code">
            <input
              id="operator-code"
              required
              disabled={Boolean(editingOperator)}
              value={draft.kodeOperator}
              onChange={(event) =>
                onChange({ ...draft, kodeOperator: event.target.value })
              }
              className={INPUT_CLASS}
            />
          </FormField>
          <FormField label="Username" htmlFor="operator-username">
            <input
              id="operator-username"
              required
              disabled={Boolean(editingOperator)}
              autoComplete="username"
              autoCapitalize="none"
              value={draft.username}
              onChange={(event) =>
                onChange({ ...draft, username: event.target.value })
              }
              className={INPUT_CLASS}
            />
          </FormField>
        </div>
        <FormField label="Nama operator" htmlFor="operator-name">
          <input
            id="operator-name"
            required
            value={draft.name}
            onChange={(event) =>
              onChange({ ...draft, name: event.target.value })
            }
            className={INPUT_CLASS}
          />
        </FormField>
        <FormField label="Email" htmlFor="operator-email">
          <input
            id="operator-email"
            type="email"
            required
            autoComplete="email"
            autoCapitalize="none"
            placeholder="operator@perusahaan.co.id"
            value={draft.email}
            onChange={(event) =>
              onChange({ ...draft, email: event.target.value })
            }
            className={INPUT_CLASS}
          />
        </FormField>
        <FormField label="Nomor HP" htmlFor="operator-phone">
          <input
            id="operator-phone"
            type="tel"
            required
            inputMode="tel"
            autoComplete="tel"
            placeholder="08xxxxxxxxxx"
            value={draft.noHp}
            onChange={(event) =>
              onChange({ ...draft, noHp: event.target.value })
            }
            className={INPUT_CLASS}
          />
        </FormField>
        <p className="text-[11px] leading-4 text-slate-500">
          Email dan nomor HP wajib diisi. Email dipakai untuk mengirim link
          pemulihan pada fitur Lupa Password, jadi akun tanpa email tidak dapat
          memulihkan passwordnya sendiri.
        </p>
        <FormField
          label={
            editingOperator
              ? "Password baru (opsional, min. 8 karakter)"
              : "Password (min. 8 karakter)"
          }
          htmlFor="operator-password"
        >
          <input
            id="operator-password"
            type="password"
            required={!editingOperator}
            minLength={8}
            autoComplete="new-password"
            value={draft.password}
            onChange={(event) =>
              onChange({ ...draft, password: event.target.value })
            }
            className={INPUT_CLASS}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Role" htmlFor="operator-role">
            {editingOperator?.isSuperadmin ? (
              <div className="space-y-1.5">
                <input
                  id="operator-role"
                  disabled
                  value={editingOperator.roleName || "Superadmin"}
                  className={INPUT_CLASS}
                />
                <p className="text-[10px] leading-4 text-amber-400">
                  Role Superadmin sistem terkunci.
                </p>
              </div>
            ) : (
              <select
                id="operator-role"
                value={draft.roleId}
                onChange={(event) =>
                  onChange({ ...draft, roleId: Number(event.target.value) })
                }
                className={INPUT_CLASS}
              >
                {roles
                  .filter(
                    (role) =>
                      !role.isSuperadmin &&
                      (role.status === "Aktif" || role.id === draft.roleId),
                  )
                  .map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
              </select>
            )}
          </FormField>
          <FormField label="Status" htmlFor="operator-status">
            <select
              id="operator-status"
              disabled={editingOperator?.isSuperadmin}
              value={draft.status}
              onChange={(event) =>
                onChange({
                  ...draft,
                  status: event.target.value as "Aktif" | "Nonaktif",
                })
              }
              className={INPUT_CLASS}
            >
              <option value="Aktif">Aktif</option>
              {!editingOperator?.isSuperadmin ? (
                <option value="Nonaktif">Nonaktif</option>
              ) : null}
            </select>
          </FormField>
        </div>
        <ModalActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function RoleFormModal({
  isOpen,
  editingRole,
  scanSecurity,
  draft,
  permissions,
  saving,
  onDraftChange,
  onPermissionsChange,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  editingRole: RoleRecord | null;
  scanSecurity: { photoEnabled: boolean; ipRestrictionEnabled: boolean };
  draft: RoleFormState;
  permissions: Set<PermissionKey>;
  saving: boolean;
  onDraftChange: (draft: RoleFormState) => void;
  onPermissionsChange: (permissions: Set<PermissionKey>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingRole ? "Edit role & akses" : "Buat role baru"}
      titleId="role-modal-title"
      maxWidth="max-w-md"
      hideFooter
    >
      <form className="space-y-4 text-xs" onSubmit={onSubmit}>
        <FormField label="Nama role" htmlFor="role-name">
          <input
            id="role-name"
            required
            minLength={3}
            disabled={editingRole?.isSuperadmin}
            value={draft.name}
            onChange={(event) =>
              onDraftChange({ ...draft, name: event.target.value })
            }
            className={INPUT_CLASS}
          />
        </FormField>
        <FormField label="Deskripsi" htmlFor="role-description">
          <textarea
            id="role-description"
            rows={3}
            disabled={editingRole?.isSuperadmin}
            value={draft.description}
            onChange={(event) =>
              onDraftChange({ ...draft, description: event.target.value })
            }
            className={`${INPUT_CLASS} py-2.5`}
          />
        </FormField>
        {!editingRole?.isSuperadmin ? (
          <fieldset>
            <legend className="text-[11px] font-black uppercase tracking-wider text-slate-300">
              Permission role ({permissions.size})
            </legend>
            <div className="mt-2 max-h-72 space-y-4 overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-slate-950/60 p-3">
              {Object.entries(EDITABLE_PERMISSION_GROUPS).map(
                ([group, groupPermissions]) => (
                  <div key={group}>
                    <p className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-sky-300">
                      {group}
                    </p>
                    <div className="grid gap-1.5">
                      {groupPermissions.map((permission) => (
                        <label
                          key={permission.key}
                          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/4 px-3 text-xs text-slate-200"
                        >
                          <input
                            type="checkbox"
                            checked={permissions.has(permission.key)}
                            onChange={(event) => {
                              const next = new Set(permissions);
                              if (event.target.checked)
                                next.add(permission.key);
                              else next.delete(permission.key);
                              onPermissionsChange(next);
                            }}
                            className="size-4 shrink-0 accent-sky-400"
                          />
                          {permission.name}
                        </label>
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>
          </fieldset>
        ) : (
          <FeedbackBanner
            type="success"
            message="Superadmin selalu memiliki seluruh permission."
          />
        )}
        {editingRole && !editingRole.isSuperadmin ? (
          <FormField label="Status role" htmlFor="role-status">
            <select
              id="role-status"
              value={draft.status}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  status: event.target.value as "Aktif" | "Nonaktif",
                })
              }
              className={INPUT_CLASS}
            >
              <option value="Aktif">Aktif</option>
              <option value="Nonaktif">Nonaktif</option>
            </select>
          </FormField>
        ) : null}
        {!editingRole?.isSuperadmin ? (
          <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/50 p-3">
            <input
              type="checkbox"
              checked={draft.requireTotp}
              onChange={(event) =>
                onDraftChange({ ...draft, requireTotp: event.target.checked })
              }
              className="mt-0.5 size-4 shrink-0 accent-sky-400"
            />
            <span className="text-[11px] leading-5 text-slate-300">
              <strong className="text-white">
                Wajibkan verifikasi dua langkah
              </strong>
              <br />
              Operator dengan role ini tidak dapat login sampai mengaktifkan 2FA
              di Pengaturan. Nyalakan hanya setelah mereka sempat
              mendaftarkannya — bila tidak, mereka akan tertahan di layar login
              dan perlu dibukakan Admin.
            </span>
          </label>
        ) : null}
        {!scanSecurity.photoEnabled || !scanSecurity.ipRestrictionEnabled ? (
          <p className="rounded-2xl border border-amber-300/25 bg-amber-300/10 p-3 text-[11px] leading-5 text-amber-100">
            {!scanSecurity.photoEnabled && !scanSecurity.ipRestrictionEnabled
              ? "Fitur foto bukti dan pembatasan IP sedang NONAKTIF di Pengaturan, jadi kedua sakelar di bawah belum berpengaruh."
              : !scanSecurity.photoEnabled
                ? "Fitur foto bukti sedang NONAKTIF di Pengaturan, jadi sakelar foto di bawah belum berpengaruh."
                : "Fitur pembatasan IP sedang NONAKTIF di Pengaturan, jadi sakelar IP di bawah belum berpengaruh."}
          </p>
        ) : null}
        <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/50 p-3">
          <input
            type="checkbox"
            checked={draft.requireScanPhoto}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                requireScanPhoto: event.target.checked,
              })
            }
            className="mt-0.5 size-4 shrink-0 accent-sky-400"
          />
          <span className="text-[11px] leading-5 text-slate-300">
            <strong className="text-white">Wajibkan foto bukti absensi</strong>
            <br />
            Setiap scan oleh operator role ini harus menyertakan foto dari
            kamera terminal. Scan tanpa foto ditolak dan tetap tercatat di log
            scan sebagai bukti percobaan. Fotonya dapat ditinjau di halaman Foto
            Absensi.
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/50 p-3">
          <input
            type="checkbox"
            checked={draft.requireScanIpAllowlist}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                requireScanIpAllowlist: event.target.checked,
              })
            }
            className="mt-0.5 size-4 shrink-0 accent-sky-400"
          />
          <span className="text-[11px] leading-5 text-slate-300">
            <strong className="text-white">Batasi absensi ke daftar IP</strong>
            <br />
            Operator role ini hanya dapat melakukan scan dari alamat IP yang
            terdaftar di Pengaturan. Selama daftar itu masih kosong, pembatasan
            belum berlaku — isi daftarnya agar sakelar ini benar benar menjaga.
          </span>
        </label>
        {editingRole?.isSuperadmin ? (
          <p className="text-[11px] leading-5 text-slate-400">
            Nama, deskripsi, dan permission Superadmin terkunci. Yang tersimpan
            dari layar ini hanya dua kewajiban absensi di atas.
          </p>
        ) : null}
        <ModalActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[11px] font-semibold text-slate-400"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function ModalActions({
  saving,
  onCancel,
}: {
  saving: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-white/10 pt-4">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-300 transition hover:bg-white/10 active:scale-95 disabled:opacity-50"
      >
        Batal
      </button>
      <button
        type="submit"
        disabled={saving}
        className="min-h-11 flex-1 rounded-xl bg-sky-500 text-xs font-black text-slate-950 shadow-lg transition hover:bg-sky-400 active:scale-95 disabled:opacity-50"
      >
        {saving ? "Menyimpan..." : "Simpan"}
      </button>
    </div>
  );
}
