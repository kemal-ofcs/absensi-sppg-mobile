"use client";

import {
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { audioSynth } from "@/lib/client/audio";
import {
  getCachedCoordinates,
  getCurrentCoordinates,
  watchCoordinates,
} from "@/lib/client/geolocation";
import { triggerHaptic } from "@/lib/client/haptics";
import {
  captureScanPhoto,
  isFaceVisible,
  openFaceCamera,
  type ScanPhotoCapture,
  stopVideoStream,
} from "@/lib/client/scan-photo";
import { requestScreenWakeLock } from "@/lib/client/wakelock";
import type { ScanResult, ScanTerminalInput } from "@/lib/contracts/scanner";
import { getScanSecurity } from "@/lib/gateways/scan-security";
import { submitTerminalScan } from "@/lib/gateways/scanner";
import { requestSyncNow } from "@/lib/gateways/sync-status";

type ScanLogItem = {
  id: string;
  waktu: string;
  nama: string;
  idUnik: string;
  divisi: string;
  jenisScan: string;
  statusProses: string;
  pesan: string;
  sukses: boolean;
};

export function ScannerView() {
  // Jawabannya dihitung Rust (sakelar induk DAN sakelar role), lalu dibaca
  // ulang setiap siklus sync. Menggabungkannya di sini dari objek sesi React
  // akan memakai salinan yang dibekukan saat login — sakelar role yang baru
  // diubah tidak akan pernah terlihat sampai aplikasi ditutup.
  const [requiresScanPhoto, setRequiresScanPhoto] = useState(false);

  // Sakelar induk hidup di setting yang ikut sinkronisasi, jadi ia dibaca ulang
  // setiap siklus sync selesai — mematikannya dari Desktop langsung berlaku di
  // ponsel ini tanpa perlu login ulang.
  useEffect(() => {
    let cancelled = false;
    const muat = () => {
      getScanSecurity()
        .then((settings) => {
          if (!cancelled) setRequiresScanPhoto(settings.photoRequiredForMe);
        })
        .catch(() => undefined);
    };
    muat();
    window.addEventListener("sppg:sync-completed", muat);
    return () => {
      cancelled = true;
      window.removeEventListener("sppg:sync-completed", muat);
    };
  }, []);

  const [cameraActive, setCameraActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [_lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanLogItem[]>([]);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [manualInput, setManualInput] = useState<string>("");
  const [audioFeedback, setAudioFeedback] = useState<boolean>(true);
  const [hapticFeedback, setHapticFeedback] = useState<boolean>(true);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [torchSupported, setTorchSupported] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // Penahanan scan untuk foto wajah. Begitu QR terbaca dan role mewajibkan
  // foto, absensi DITAHAN: kamera hadap-depan dibuka, orangnya difoto beserta
  // latarnya, baru datanya dikirim. Memotret pada detik QR terbaca hanya
  // menghasilkan foto kartu yang sedang ditempelkan ke lensa.
  const [pendingScan, setPendingScan] = useState<string | null>(null);
  const [faceCameraReady, setFaceCameraReady] = useState(false);
  const [faceVisible, setFaceVisible] = useState(false);
  /** Wajah terdeteksi stabil dan sedang dihitung mundur untuk jepretan. */
  const [faceHolding, setFaceHolding] = useState(false);
  const [faceCountdown, setFaceCountdown] = useState(0);
  const [faceMessage, setFaceMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const faceVideoRef = useRef<HTMLVideoElement>(null);
  const faceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Kamera QR sedang hidup sebelum penahanan, jadi wajib dinyalakan lagi. */
  const resumeCameraRef = useRef(false);
  /** `startCamera` didefinisikan setelah blok ini; ref menjembataninya. */
  const startCameraRef = useRef<(() => Promise<void>) | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const isSubmittingRef = useRef(false);
  const lastScannedQrRef = useRef<string>("");
  const lastScannedTimeRef = useRef<number>(0);

  // Background GPS coordinates watcher
  useEffect(() => {
    const unwatch = watchCoordinates();
    void getCurrentCoordinates();
    return () => unwatch();
  }, []);

  // Request Wake Lock to keep phone screen awake while scanning
  useEffect(() => {
    let cleanupWakeLock: (() => void) | undefined;
    let cancelled = false;
    if (cameraActive) {
      void requestScreenWakeLock().then((cleanup) => {
        if (cancelled) {
          cleanup();
        } else {
          cleanupWakeLock = cleanup;
        }
      });
    }
    return () => {
      cancelled = true;
      cleanupWakeLock?.();
    };
  }, [cameraActive]);

  // Stop camera helper
  const stopCamera = useCallback(() => {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  // Stop camera when user minimizes app or navigates away
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopCamera();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [stopCamera]);

  // Clean up scanner and media tracks on component unmount
  useEffect(() => {
    return () => {
      scannerControlsRef.current?.stop();
      const stream = videoRef.current?.srcObject;
      if (stream instanceof MediaStream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
    };
  }, []);

  // Query video devices
  const loadCameraDevices = useCallback(async () => {
    try {
      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      setCameraDevices(devices);
      if (devices.length > 0 && !selectedDeviceId) {
        // Prefer rear camera on mobile
        const backCamera = devices.find(
          (d) =>
            d.label.toLowerCase().includes("back") ||
            d.label.toLowerCase().includes("belakang") ||
            d.label.toLowerCase().includes("rear") ||
            d.label.toLowerCase().includes("environment"),
        );
        setSelectedDeviceId(backCamera?.deviceId || devices[0].deviceId);
      }
    } catch {
      // Ignore device enumeration failures
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    void loadCameraDevices();
  }, [loadCameraDevices]);

  // Handle Scan Submission with Audio, Haptics, and GPS
  const submitScan = useCallback(
    async (trimmed: string, photo: ScanPhotoCapture | null) => {
      isSubmittingRef.current = true;
      setIsProcessing(true);

      try {
        const gps = getCachedCoordinates();
        const payload: ScanTerminalInput = {
          qrContent: trimmed,
          lat: gps?.lat,
          lng: gps?.lng,
          fotoBase64: photo?.base64,
          fotoMime: photo?.mime,
        };

        const result = await submitTerminalScan(payload);
        setLastResult(result);

        // Bangunkan siklus sinkronisasi, JANGAN menunggu jadwal berikutnya.
        //
        // Absensi adalah satu-satunya mutasi bervolume tinggi yang tidak punya
        // pemicu push sendiri: hanya lima perintah pengaturan yang memanggil
        // `push_outbox` langsung, dan jalur ini tidak termasuk. Tanpa panggilan
        // ini sebuah scan menunggu sampai 30 detik sebelum terkirim — dan pada
        // terminal yang jendelanya tersembunyi, sampai 90 detik.
        //
        // Sengaja LEPAS dari alur scan (tidak di-`await`) supaya tidak menambah
        // satu milidetik pun ke waktu respons terminal, dan sudah di-throttle
        // 5 detik oleh AutoSyncRunner sehingga antrean panjang saat jam masuk
        // tidak berubah menjadi badai siklus.
        if (result.sukses) requestSyncNow();

        const isSuccess = Boolean(result.sukses);

        // Haptic Feedback
        if (hapticFeedback) {
          triggerHaptic(isSuccess ? "success" : "error");
        }

        // Audio & Speech Feedback
        if (audioFeedback) {
          if (isSuccess) {
            audioSynth.playSuccessBeep();
            if (result.nama) {
              audioSynth.speak(
                `${result.nama}. ${result.jenisScan || "Berhasil"}`,
              );
            }
          } else {
            audioSynth.playErrorBeep();
            audioSynth.speak(result.pesan || "Scan ditolak");
          }
        }

        // Log history card
        setScanHistory((prev) => [
          {
            id: String(Date.now()),
            waktu: new Date().toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
            nama: result.nama || "Tanpa Nama",
            idUnik: result.idKaryawan || "-",
            divisi: result.divisi || "-",
            jenisScan: result.jenisScan || (isSuccess ? "Masuk" : "Ditolak"),
            statusProses: result.status || (isSuccess ? "Berhasil" : "Ditolak"),
            pesan: result.pesan || "",
            sukses: isSuccess,
          },
          ...prev.slice(0, 19),
        ]);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Gagal memproses absensi";
        if (hapticFeedback) triggerHaptic("error");
        if (audioFeedback) audioSynth.playErrorBeep();

        setScanHistory((prev) => [
          {
            id: String(Date.now()),
            waktu: new Date().toLocaleTimeString("id-ID"),
            nama: "Error",
            idUnik: "-",
            divisi: "-",
            jenisScan: "Error",
            statusProses: "Gagal",
            pesan: message,
            sukses: false,
          },
          ...prev.slice(0, 19),
        ]);
      } finally {
        setIsProcessing(false);
        setTimeout(() => {
          isSubmittingRef.current = false;
        }, 1500);
      }
    },
    [audioFeedback, hapticFeedback],
  );

  const stopFaceCamera = useCallback(() => {
    if (faceTimerRef.current) {
      clearTimeout(faceTimerRef.current);
      faceTimerRef.current = null;
    }
    stopVideoStream(faceVideoRef.current);
    setFaceCameraReady(false);
    setFaceVisible(false);
    setFaceHolding(false);
    setFaceCountdown(0);
  }, []);

  // Pembersihan saat unmount SAJA — dependency kosong. Menautkannya ke effect
  // yang bergantung pada state akan mematikan kamera WebView Android tepat
  // setelah dibuka (aturan siklus kamera repo ini).
  useEffect(() => () => stopFaceCamera(), [stopFaceCamera]);

  /**
   * Gerbang scan: tanpa kewajiban foto langsung dikirim, dengan kewajiban foto
   * QR ditahan sampai wajah orangnya terpotret.
   */
  const handleProcessQr = useCallback(
    async (qrRaw: string) => {
      const trimmed = qrRaw.trim();
      if (!trimmed || isSubmittingRef.current || pendingScan) return;

      // Debounce identical scans within 3 seconds
      const now = Date.now();
      if (
        lastScannedQrRef.current === trimmed &&
        now - lastScannedTimeRef.current < 3000
      ) {
        return;
      }
      lastScannedQrRef.current = trimmed;
      lastScannedTimeRef.current = now;

      if (!requiresScanPhoto) {
        await submitScan(trimmed, null);
        return;
      }

      if (hapticFeedback) triggerHaptic("light");
      setFaceMessage(null);
      // Kamera QR dimatikan lebih dulu: membuka kamera kedua sementara stream
      // pemindai masih hidup membuat keduanya saling mematikan di WebView.
      // Status kamera dibaca dari REF, bukan dari state: callback pemindai
      // dibuat sekali saat kamera dinyalakan dan membekukan nilai state saat
      // itu (`cameraActive === false`, karena kameranya baru mau hidup). Dengan
      // state, kamera pemindai tidak pernah menyala lagi setelah foto diambil.
      const qrCameraLive = scannerControlsRef.current !== null;
      resumeCameraRef.current = qrCameraLive;
      if (qrCameraLive) stopCamera();
      // Kameranya dibuka pada effect di bawah, bukan di sini: elemen <video>
      // baru ada di DOM setelah React merender panel penahanan.
      setPendingScan(trimmed);
    },
    [requiresScanPhoto, submitScan, pendingScan, stopCamera, hapticFeedback],
  );

  // Buka kamera begitu panel penahanan terpasang.
  useEffect(() => {
    if (!pendingScan) return;
    let cancelled = false;
    void (async () => {
      try {
        // Terminal Mobile dipasang dengan kamera BELAKANG menghadap keluar ke
        // karyawan — persis kamera yang dipakai memindai QR. Memaksa kamera
        // depan di sini akan memotret ke arah operator/tembok di belakang
        // ponsel, bukan wajah karyawan yang absen.
        const stream = await openFaceCamera("environment");
        const video = faceVideoRef.current;
        if (cancelled || !video) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (!cancelled) setFaceCameraReady(true);
      } catch {
        if (!cancelled) {
          setFaceMessage(
            "Kamera tidak dapat dibuka. Role Anda mewajibkan foto bukti, jadi absensi tidak bisa dikirim tanpa kamera.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingScan]);

  /**
   * Nyalakan kembali kamera pemindai setelah penahanan selesai.
   *
   * Debounce QR terakhir ikut disegarkan: kartu yang sama masih di depan lensa
   * saat kamera hidup lagi, dan tanpa ini ia langsung terbaca ulang lalu
   * ditolak backend sebagai scan ganda.
   */
  const resumeQrCamera = useCallback(() => {
    if (!resumeCameraRef.current) return;
    resumeCameraRef.current = false;
    lastScannedTimeRef.current = Date.now();
    void startCameraRef.current?.();
  }, []);

  const closePhotoHold = useCallback(() => {
    stopFaceCamera();
    setPendingScan(null);
    resumeQrCamera();
  }, [stopFaceCamera, resumeQrCamera]);

  const capturePhotoAndSubmit = useCallback(async () => {
    const qr = pendingScan;
    if (!qr) return;
    const photo = captureScanPhoto(faceVideoRef.current);
    if (!photo) {
      setFaceMessage("Foto belum terambil. Coba lagi.");
      return;
    }
    stopFaceCamera();
    setPendingScan(null);
    await submitScan(qr, photo);
    // Kamera pemindai baru dinyalakan SETELAH absensi terkirim, supaya kartu
    // yang masih menempel di lensa tidak terbaca ulang selagi permintaan jalan.
    resumeQrCamera();
  }, [pendingScan, stopFaceCamera, resumeQrCamera, submitScan]);

  // Fase membidik lalu menahan diam sejenak sebelum memotret sendiri.
  //
  // Deteksi wajah masuk bingkai saja mudah diakali: karyawan cukup melintas
  // sekilas di depan kamera lalu menyingkir sebelum jepretan sungguhan.
  // Begitu wajah terdeteksi, sistem WAJIB melihatnya tetap ada selama
  // HOLD_STILL_MS berturut-turut — wajah yang hilang di tengah jalan
  // membatalkan hitungan dan mengulang dari awal — baru jepretan diambil,
  // dengan teks "Jangan bergerak" di layar.
  //
  // Deteksi wajahnya memakai ulang detektor piksel milik verifikasi "Lupa
  // Password" dan hanya berperan sebagai pemandu — jepretan tetap berjalan
  // otomatis setelah tenggat FORCE_AFTER_MS meski wajah tidak pernah terbaca
  // sama sekali, supaya kamera murah atau ruangan gelap tidak pernah
  // memblokir absensi seseorang.
  useEffect(() => {
    if (!pendingScan || !faceCameraReady) return;
    const TICK_MS = 150;
    const HOLD_STILL_MS = 1_400;
    const FORCE_AFTER_MS = 20_000;
    const startedAt = Date.now();
    let holdStartedAt: number | null = null;

    const tick = () => {
      const visible = isFaceVisible(faceVideoRef.current);
      const now = Date.now();
      setFaceVisible(visible);
      holdStartedAt = visible ? (holdStartedAt ?? now) : null;
      const holding = holdStartedAt !== null;
      setFaceHolding(holding);
      const holdElapsed = holding ? now - (holdStartedAt as number) : 0;
      setFaceCountdown(
        Math.max(0, Math.ceil((HOLD_STILL_MS - holdElapsed) / 1000)),
      );
      const overallElapsed = now - startedAt;
      if (
        (holding && holdElapsed >= HOLD_STILL_MS) ||
        overallElapsed >= FORCE_AFTER_MS
      ) {
        void capturePhotoAndSubmit();
        return;
      }
      faceTimerRef.current = setTimeout(tick, TICK_MS);
    };

    faceTimerRef.current = setTimeout(tick, TICK_MS);
    return () => {
      if (faceTimerRef.current) clearTimeout(faceTimerRef.current);
    };
  }, [pendingScan, faceCameraReady, capturePhotoAndSubmit]);

  // Start Camera Stream
  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError(null);

    if (!videoRef.current) return;

    try {
      const codeReader = new BrowserMultiFormatReader();
      let constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };

      if (selectedDeviceId) {
        constraints = {
          video: {
            deviceId: { ideal: selectedDeviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        };
      }

      let controls: IScannerControls;
      try {
        controls = await codeReader.decodeFromConstraints(
          constraints,
          videoRef.current,
          (result, _error) => {
            if (result) {
              void handleProcessQr(result.getText());
            }
          },
        );
      } catch {
        controls = await codeReader.decodeFromConstraints(
          { video: true },
          videoRef.current,
          (result, _error) => {
            if (result) {
              void handleProcessQr(result.getText());
            }
          },
        );
      }

      scannerControlsRef.current = controls;
      setCameraActive(true);

      // Check for torch capability
      const stream = videoRef.current.srcObject as MediaStream | null;
      const track = stream?.getVideoTracks()[0];
      if (track) {
        const capabilities = track.getCapabilities?.() as
          | { torch?: boolean }
          | undefined;
        if (capabilities?.torch) {
          setTorchSupported(true);
        }
      }

      // Update camera devices list now that permission is granted
      void loadCameraDevices();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Kamera tidak dapat diakses. Pastikan izin kamera aktif.";
      setCameraError(message);
      setCameraActive(false);
    }
  }, [handleProcessQr, loadCameraDevices, selectedDeviceId, stopCamera]);

  // Toggle Flashlight/Torch
  const toggleTorch = async () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()[0];
    if (track) {
      try {
        const nextTorch = !torchOn;
        await track.applyConstraints({
          advanced: [{ torch: nextTorch } as MediaTrackConstraintSet],
        });
        setTorchOn(nextTorch);
        triggerHaptic("light");
      } catch {
        // Torch constraint failed
      }
    }
  };

  // Jembatan untuk closePhotoHold: startCamera didefinisikan setelah gerbang
  // scan, jadi refnya diperbarui setiap render.
  startCameraRef.current = startCamera;

  return (
    <div className="flex flex-col gap-4">
      {/* Penahanan scan untuk foto wajah + latar. Panel menutupi layar supaya
          jelas bahwa absensi BELUM terkirim sampai fotonya diambil. */}
      {pendingScan ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-3xl border border-white/10 bg-slate-900 p-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                QR terbaca — absensi ditahan
              </p>
              <h2 className="mt-1 text-base font-black text-white">
                Ambil foto wajah &amp; latar
              </h2>
              <p className="mt-1 text-[11px] leading-5 text-slate-400">
                Hadapkan wajah ke kamera bersama latar tempat Anda berdiri. Foto
                diambil otomatis setelah wajah terdeteksi dan Anda tahan diam
                sejenak.
              </p>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950">
              <video
                ref={faceVideoRef}
                muted
                playsInline
                aria-label="Pratinjau kamera foto bukti absensi"
                // TIDAK dicerminkan: ini kamera BELAKANG menghadap karyawan,
                // bukan kamera selfie. Mencerminkan feed kamera belakang
                // membuat orang di layar terbalik kiri-kanan.
                className="aspect-[3/4] w-full object-cover"
              >
                <track kind="captions" />
              </video>
              {faceCameraReady ? (
                <>
                  {faceHolding ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-950/30">
                      <div className="rounded-2xl bg-slate-950/80 px-4 py-2.5 text-center">
                        <p className="text-base font-black text-emerald-300">
                          Jangan bergerak
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-300">
                          Foto diambil dalam {faceCountdown}s
                        </p>
                      </div>
                    </div>
                  ) : null}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-slate-950 to-transparent p-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
                        faceHolding
                          ? "bg-emerald-400/20 text-emerald-200"
                          : faceVisible
                            ? "bg-sky-400/20 text-sky-200"
                            : "bg-amber-400/20 text-amber-200"
                      }`}
                    >
                      {faceHolding
                        ? "Menahan diam..."
                        : faceVisible
                          ? "Wajah terdeteksi"
                          : "Posisikan wajah"}
                    </span>
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 grid place-items-center text-[11px] text-slate-400">
                  Menyalakan kamera...
                </div>
              )}
            </div>

            {faceMessage ? (
              <output className="block rounded-xl border border-rose-400/30 bg-rose-400/10 p-2.5 text-[11px] text-rose-100">
                {faceMessage}
              </output>
            ) : null}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void capturePhotoAndSubmit()}
                disabled={!faceCameraReady}
                className="min-h-11 flex-1 rounded-xl bg-emerald-400 text-xs font-black text-slate-950 active:scale-95 disabled:opacity-50"
              >
                Ambil foto sekarang
              </button>
              <button
                type="button"
                onClick={closePhotoHold}
                className="min-h-11 rounded-xl border border-white/15 px-4 text-xs font-bold text-slate-300 active:scale-95"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Top Camera Viewport Card */}
      <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-slate-900 shadow-2xl">
        <div className="theme-invariant relative aspect-[4/3] w-full bg-black flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`size-full object-cover ${cameraActive ? "block" : "hidden"}`}
          />

          {/* Inactive State Overlay */}
          {!cameraActive && (
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <div className="grid size-16 place-items-center rounded-3xl border border-sky-400/30 bg-sky-500/10 text-sky-300 shadow-lg shadow-sky-950/40 mb-3">
                <Icon name="scanner" className="size-8 stroke-[2]" />
              </div>
              <h3 className="text-base font-bold text-white mb-1">
                Kamera QR Scanner
              </h3>
              <p className="text-xs text-slate-400 max-w-[240px] mb-4">
                Posisikan QR Code karyawan di dalam bingkai untuk absensi
                instan.
              </p>
              <button
                type="button"
                onClick={startCamera}
                className="flex min-h-11 items-center gap-2 rounded-2xl bg-gradient-to-r from-sky-400 to-blue-600 px-6 font-bold text-slate-950 shadow-lg shadow-sky-950/50 active:scale-95 transition"
              >
                <Icon name="scanner" className="size-4" />
                <span>Buka Kamera</span>
              </button>
            </div>
          )}

          {/* Active Scanner Laser & Reticle */}
          {cameraActive && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {/* Corner brackets */}
              <div className="relative size-60 rounded-3xl border-2 border-sky-400/60 shadow-[0_0_20px_rgba(56,189,248,0.3)]">
                <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-sky-300 to-transparent animate-[pulse_1.5s_infinite]" />
              </div>
            </div>
          )}

          {/* Processing Spinner Overlay */}
          {isProcessing && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2">
                <div className="size-10 rounded-full border-3 border-sky-400 border-t-transparent animate-spin" />
                <span className="text-xs font-bold text-sky-200">
                  Memproses Scan...
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Viewport Control Bar */}
        {cameraActive && (
          <div className="flex items-center justify-between border-t border-white/10 bg-slate-950/90 px-4 py-3">
            <div className="flex items-center gap-2">
              {torchSupported && (
                <button
                  type="button"
                  onClick={toggleTorch}
                  aria-label="Toggle Flashlight"
                  className={`grid size-10 place-items-center rounded-xl border transition ${
                    torchOn
                      ? "border-amber-400/40 bg-amber-400/20 text-amber-300"
                      : "border-white/10 bg-white/5 text-slate-300"
                  }`}
                >
                  <Icon name="tools" className="size-5" />
                </button>
              )}
              {cameraDevices.length > 1 && (
                <select
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400"
                >
                  {cameraDevices.map((dev, index) => (
                    <option key={dev.deviceId} value={dev.deviceId}>
                      {dev.label || `Kamera ${index + 1}`}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <button
              type="button"
              onClick={stopCamera}
              className="flex min-h-10 items-center gap-2 rounded-xl bg-rose-500/20 border border-rose-500/30 px-3.5 text-xs font-bold text-rose-300 active:scale-95 transition"
            >
              <span>Matikan</span>
            </button>
          </div>
        )}
      </div>

      {cameraError && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-950/40 p-3 text-xs text-rose-200">
          ⚠️ {cameraError}
        </div>
      )}

      {/* Hardware Toggles & Manual Input Bar */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-3.5 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Feedback & Hardware
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setAudioFeedback(!audioFeedback);
                triggerHaptic("light");
              }}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                audioFeedback
                  ? "border-sky-400/40 bg-sky-500/20 text-sky-300"
                  : "border-white/10 bg-white/5 text-slate-400"
              }`}
            >
              <Icon name="tools" className="size-3.5" />
              <span>Suara {audioFeedback ? "Aktif" : "Mati"}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setHapticFeedback(!hapticFeedback);
                triggerHaptic("light");
              }}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                hapticFeedback
                  ? "border-sky-400/40 bg-sky-500/20 text-sky-300"
                  : "border-white/10 bg-white/5 text-slate-400"
              }`}
            >
              <span>Getar {hapticFeedback ? "Aktif" : "Mati"}</span>
            </button>
          </div>
        </div>

        {/* Manual QR Input Fallback */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (manualInput.trim()) {
              void handleProcessQr(manualInput);
              setManualInput("");
            }
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="Ketik kode QR manual (ID|TOKEN)..."
            className="flex-1 rounded-xl border border-white/10 bg-slate-950/80 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!manualInput.trim() || isProcessing}
            className="flex min-h-10 items-center justify-center rounded-xl bg-sky-500 px-4 text-xs font-bold text-slate-950 disabled:opacity-50 active:scale-95 transition"
          >
            Proses
          </button>
        </form>
      </div>

      {/* Live Scan History Feed */}
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
          Riwayat Scan Sesi Ini ({scanHistory.length})
        </h4>

        {scanHistory.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 text-center text-xs text-slate-500">
            Belum ada data scan pada sesi ini.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {scanHistory.map((item) => (
              <div
                key={item.id}
                className={`flex items-center justify-between rounded-2xl border p-3 backdrop-blur-md transition ${
                  item.sukses
                    ? "border-emerald-500/30 bg-emerald-950/20"
                    : "border-rose-500/30 bg-rose-950/20"
                }`}
              >
                <div className="flex flex-col min-w-0 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white truncate">
                      {item.nama}
                    </span>
                    <StatusBadge status={item.statusProses} />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                    <span>{item.divisi}</span>
                    <span>•</span>
                    <span>{item.waktu}</span>
                    <span>•</span>
                    <span className="text-sky-300 font-medium">
                      {item.jenisScan}
                    </span>
                  </div>
                  {item.pesan && (
                    <p className="text-[11px] text-slate-300 mt-1 line-clamp-1">
                      {item.pesan}
                    </p>
                  )}
                </div>
                <div
                  className={`grid size-9 shrink-0 place-items-center rounded-xl font-black text-sm ${
                    item.sukses
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-rose-500/20 text-rose-300"
                  }`}
                >
                  {item.sukses ? "✓" : "✕"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
