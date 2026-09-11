"use client";

import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { triggerHaptic } from "@/lib/client/haptics";
import { formatBytes, optimizeImageFile } from "@/lib/client/image-optimizer";
import { BRANDING } from "@/lib/constants/branding";
import {
  getAppDisplayName,
  saveAppDisplayName,
} from "@/lib/gateways/app-setting";
import {
  type CompanyProfile,
  getCompanyProfile,
  updateCompanyProfile,
} from "@/lib/gateways/company-profile";
import { syncAppLogoCache } from "@/lib/hooks/useAppLogo";
import { syncAppNameCache } from "@/lib/hooks/useAppName";
import { syncCompanyNameCache } from "@/lib/hooks/useCompanyName";

/*
 * Profil Instansi & identitas ID Card untuk Pengaturan Mobile — padanan
 * formulir "Profil Instansi & Identitas ID Card" di Pengaturan Web/Desktop.
 *
 * Logo di sini SAMA dengan "Logo aplikasi" Web: keduanya menulis
 * `company_profile.logo_url`, yang ikut outbox sehingga tersebar ke cloud,
 * Desktop, dan Mobile lain. Karena itu Mobile cukup punya satu tempat unggah.
 *
 * Pemanggil wajib menjaga kartu ini dengan izin `settings.manage` — izin yang
 * juga dituntut `desktop_get/update_company_profile` dan
 * `desktop_update_app_display_name` di backend.
 */

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const TIMEZONES = [
  { value: "Asia/Jakarta", label: "WIB (Asia/Jakarta)" },
  { value: "Asia/Makassar", label: "WITA (Asia/Makassar)" },
  { value: "Asia/Jayapura", label: "WIT (Asia/Jayapura)" },
];

const INPUT_CLASS =
  "min-h-11 w-full rounded-xl border border-white/15 bg-slate-950 px-3 text-xs text-white placeholder-slate-500 outline-none transition focus:border-sky-400";

const EMPTY_PROFILE: CompanyProfile = {
  id: "default_company",
  company_name: BRANDING.defaultCompanyName,
  branch_name: BRANDING.defaultBranchName,
  logo_url: null,
  signature_url: null,
  address: null,
  phone: null,
  email: null,
  website: null,
  leader_name: null,
  leader_title: null,
  leader_nip: null,
  card_terms: null,
  timezone: "Asia/Jakarta",
  updated_at: "",
};

type Feedback = { type: "success" | "error"; message: string } | null;

export function CompanyProfileCard() {
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY_PROFILE);
  const [appName, setAppName] = useState<string>(BRANDING.appDisplayName);
  const [draft, setDraft] = useState<CompanyProfile>(EMPTY_PROFILE);
  const [draftAppName, setDraftAppName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const isSubmittingRef = useRef(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [formFeedback, setFormFeedback] = useState<Feedback>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [loadedProfile, loadedName] = await Promise.all([
        getCompanyProfile(),
        getAppDisplayName(),
      ]);
      setProfile(loadedProfile);
      setAppName(loadedName);
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Profil instansi tidak dapat dibaca.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = () => {
    triggerHaptic("light");
    setDraft(profile);
    setDraftAppName(appName);
    setFormFeedback(null);
    setModalOpen(true);
  };

  const setField = <K extends keyof CompanyProfile>(
    key: K,
    value: CompanyProfile[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const handleImagePick = async (
    event: ChangeEvent<HTMLInputElement>,
    field: "logo_url" | "signature_url",
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setFormFeedback({
        type: "error",
        message: "Gunakan format PNG, JPG, atau WebP.",
      });
      return;
    }
    setImageBusy(true);
    try {
      // Ukuran sama dengan Web: logo 600x600, tanda tangan 600x400, PNG.
      const optimized = await optimizeImageFile(file, {
        maxWidth: 600,
        maxHeight: field === "logo_url" ? 600 : 400,
        quality: 0.92,
        mimeType: "image/png",
        fit: "contain",
      });
      setField(field, optimized.dataUrl);
      setFormFeedback({
        type: "success",
        message: `${field === "logo_url" ? "Logo" : "Tanda tangan"} dioptimasi (${formatBytes(optimized.originalSizeBytes)} ➔ ${formatBytes(optimized.optimizedSizeBytes)}). Tekan Simpan untuk menerapkannya.`,
      });
    } catch {
      setFormFeedback({
        type: "error",
        message: "Gambar tidak dapat diproses. Coba file lain.",
      });
    } finally {
      setImageBusy(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    if (!draft.company_name.trim()) {
      triggerHaptic("error");
      setFormFeedback({
        type: "error",
        message: "Nama instansi tidak boleh kosong.",
      });
      return;
    }
    isSubmittingRef.current = true;
    setSaving(true);
    setFormFeedback(null);
    try {
      const [updated, savedName] = await Promise.all([
        updateCompanyProfile(draft),
        saveAppDisplayName(draftAppName),
      ]);
      setProfile(updated);
      setAppName(savedName);
      syncAppLogoCache(updated.logo_url);
      syncCompanyNameCache(updated.company_name);
      syncAppNameCache(savedName);
      triggerHaptic("success");
      setModalOpen(false);
      setFeedback({
        type: "success",
        message:
          "Profil instansi & identitas ID Card tersimpan dan akan tersinkron ke perangkat lain.",
      });
    } catch (err) {
      triggerHaptic("error");
      setFormFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal menyimpan profil instansi.",
      });
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="rounded-3xl border border-sky-500/20 bg-gradient-to-br from-sky-950/30 via-slate-900/80 to-slate-900/90 p-4 backdrop-blur-md">
      <div className="flex items-center gap-2.5">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-500/20 text-sky-300">
          <Icon name="id-card" className="size-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-white">
            Profil Instansi &amp; ID Card
          </h3>
          <p className="text-[11px] text-slate-400">
            Nama aplikasi, logo, tanda tangan &amp; ketentuan kartu
          </p>
        </div>
      </div>

      {feedback ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onClose={() => setFeedback(null)}
          className="mt-3 text-xs"
        />
      ) : null}

      <div className="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3">
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-white/20 bg-slate-900">
          {profile.logo_url ? (
            /* biome-ignore lint/performance/noImgElement: pratinjau data URI dari database */
            <img
              src={profile.logo_url}
              alt="Logo instansi"
              className="max-h-full max-w-full object-contain p-1"
            />
          ) : (
            <span className="text-[9px] text-slate-500">Logo default</span>
          )}
        </div>
        <div className="min-w-0 text-[11px]">
          <p className="truncate text-sm font-bold text-white">
            {loading ? "Memuat..." : profile.company_name}
          </p>
          <p className="truncate text-slate-400">
            {profile.branch_name || "Tanpa unit/cabang"}
          </p>
          <p className="truncate text-slate-500">Aplikasi: {appName}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={openEditor}
        disabled={loading}
        className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 text-xs font-black text-slate-950 shadow-md transition hover:bg-sky-400 active:scale-95 disabled:opacity-50"
      >
        <Icon name="tools" className="size-4" />
        Edit profil instansi
      </button>

      <Modal
        isOpen={modalOpen}
        onClose={() => {
          if (!saving) setModalOpen(false);
        }}
        title="Profil Instansi & ID Card"
        titleId="company-profile-modal-title"
        maxWidth="max-w-md"
        hideFooter
      >
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {formFeedback ? (
            <FeedbackBanner
              type={formFeedback.type}
              message={formFeedback.message}
              onClose={() => setFormFeedback(null)}
              className="text-xs"
            />
          ) : null}

          <Section title="1. Informasi utama">
            <Field
              label="Nama tampilan aplikasi"
              htmlFor="cp-app-name"
              hint="Tampil pada judul aplikasi, form login, dan header."
            >
              <input
                id="cp-app-name"
                value={draftAppName}
                onChange={(e) => setDraftAppName(e.target.value)}
                placeholder={`Contoh: ${BRANDING.appDisplayName}`}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Nama resmi instansi *" htmlFor="cp-company-name">
              <input
                id="cp-company-name"
                required
                value={draft.company_name}
                onChange={(e) => setField("company_name", e.target.value)}
                placeholder="Contoh: PT Maju Bersama"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Unit / cabang / wilayah" htmlFor="cp-branch">
              <input
                id="cp-branch"
                value={draft.branch_name || ""}
                onChange={(e) => setField("branch_name", e.target.value)}
                placeholder="Contoh: Kantor Pusat"
                className={INPUT_CLASS}
              />
            </Field>
          </Section>

          <Section title="2. Logo & tanda tangan">
            <ImagePicker
              id="cp-logo"
              label="Logo resmi instansi"
              hint="PNG transparan disarankan. Juga dipakai sebagai logo aplikasi."
              value={draft.logo_url}
              busy={imageBusy}
              onPick={(event) => void handleImagePick(event, "logo_url")}
              onClear={() => setField("logo_url", null)}
            />
            <ImagePicker
              id="cp-signature"
              label="Tanda tangan & stempel pimpinan"
              hint="Dicetak di bagian belakang ID Card."
              value={draft.signature_url}
              busy={imageBusy}
              onPick={(event) => void handleImagePick(event, "signature_url")}
              onClear={() => setField("signature_url", null)}
            />
          </Section>

          <Section title="3. Kontak & alamat">
            <Field label="Alamat lengkap" htmlFor="cp-address">
              <textarea
                id="cp-address"
                rows={2}
                value={draft.address || ""}
                onChange={(e) => setField("address", e.target.value)}
                placeholder="Contoh: Jl. Jend. Sudirman Kav. 52-53, Jakarta"
                className={`${INPUT_CLASS} py-2.5`}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Telepon" htmlFor="cp-phone">
                <input
                  id="cp-phone"
                  type="tel"
                  inputMode="tel"
                  value={draft.phone || ""}
                  onChange={(e) => setField("phone", e.target.value)}
                  placeholder="021-5550123"
                  className={`${INPUT_CLASS} font-mono`}
                />
              </Field>
              <Field label="Zona waktu" htmlFor="cp-timezone">
                <select
                  id="cp-timezone"
                  value={draft.timezone || "Asia/Jakarta"}
                  onChange={(e) => setField("timezone", e.target.value)}
                  className={INPUT_CLASS}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Email resmi" htmlFor="cp-email">
              <input
                id="cp-email"
                type="email"
                autoCapitalize="none"
                value={draft.email || ""}
                onChange={(e) => setField("email", e.target.value)}
                placeholder="info@instansi.id"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Website" htmlFor="cp-website">
              <input
                id="cp-website"
                type="url"
                autoCapitalize="none"
                value={draft.website || ""}
                onChange={(e) => setField("website", e.target.value)}
                placeholder="https://instansi.id"
                className={INPUT_CLASS}
              />
            </Field>
          </Section>

          <Section title="4. Data pimpinan">
            <Field label="Nama pimpinan / penandatangan" htmlFor="cp-leader">
              <input
                id="cp-leader"
                value={draft.leader_name || ""}
                onChange={(e) => setField("leader_name", e.target.value)}
                placeholder="Contoh: Dr. H. Ahmad Fauzi, M.M."
                className={INPUT_CLASS}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Jabatan" htmlFor="cp-leader-title">
                <input
                  id="cp-leader-title"
                  value={draft.leader_title || ""}
                  onChange={(e) => setField("leader_title", e.target.value)}
                  placeholder="Direktur Utama"
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="NIP / NIK" htmlFor="cp-leader-nip">
                <input
                  id="cp-leader-nip"
                  value={draft.leader_nip || ""}
                  onChange={(e) => setField("leader_nip", e.target.value)}
                  placeholder="19750815..."
                  className={`${INPUT_CLASS} font-mono`}
                />
              </Field>
            </div>
          </Section>

          <Section title="5. Ketentuan kartu">
            <Field
              label="Syarat & ketentuan di belakang ID Card"
              htmlFor="cp-card-terms"
            >
              <textarea
                id="cp-card-terms"
                rows={4}
                value={draft.card_terms || ""}
                onChange={(e) => setField("card_terms", e.target.value)}
                placeholder="Tuliskan butir-butir syarat & ketentuan ID card..."
                className={`${INPUT_CLASS} py-2.5 font-mono leading-5`}
              />
            </Field>
          </Section>

          <div className="flex items-center gap-2 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              disabled={saving}
              className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-300 transition hover:bg-white/10 active:scale-95 disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving || imageBusy}
              className="min-h-11 flex-1 rounded-xl bg-sky-500 text-xs font-black text-slate-950 shadow-lg transition hover:bg-sky-400 active:scale-95 disabled:opacity-50"
            >
              {saving ? "Menyimpan..." : "Simpan profil"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/50 p-3">
      <legend className="px-1 text-[11px] font-black uppercase tracking-wider text-sky-300">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
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
      {hint ? (
        <p className="mt-1 text-[10px] leading-4 text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

function ImagePicker({
  id,
  label,
  hint,
  value,
  busy,
  onPick,
  onClear,
}: {
  id: string;
  label: string;
  hint: string;
  value: string | null;
  busy: boolean;
  onPick: (event: ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-white/20 bg-slate-900">
        {value ? (
          /* biome-ignore lint/performance/noImgElement: pratinjau data URI yang baru dipilih */
          <img
            src={value}
            alt={label}
            className="max-h-full max-w-full object-contain p-1"
          />
        ) : (
          <span className="text-[9px] text-slate-500">Belum ada</span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-[11px] font-bold text-white">{label}</p>
        <div className="flex gap-2">
          <label
            htmlFor={id}
            className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-slate-800 px-2 text-[11px] font-bold text-white transition active:scale-95"
          >
            <Icon name="upload" className="size-3.5" />
            {busy ? "Memproses..." : "Pilih gambar"}
            <input
              id={id}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={onPick}
              className="sr-only"
            />
          </label>
          {value ? (
            <button
              type="button"
              onClick={onClear}
              className="min-h-11 rounded-xl border border-rose-400/30 px-3 text-[11px] font-bold text-rose-200 transition active:scale-95"
            >
              Hapus
            </button>
          ) : null}
        </div>
        <p className="text-[10px] leading-4 text-slate-500">{hint}</p>
      </div>
    </div>
  );
}
