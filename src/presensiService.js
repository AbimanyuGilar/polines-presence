import { getJadwal, submitPresensi, fetchInertiaVersion } from './api.js';
import { getValidApiSession } from './authService.js';
import config from './config.js';

export async function processPresensiSession(sessionUser, qrRawString) {
  let qrData;
  try {
    qrData = JSON.parse(qrRawString);
  } catch {
    return {
      status: 'error',
      message: 'QR code yang diupload bukan JSON valid.',
    };
  }

  if (!qrData.token || !qrData.id_kelas) {
    return {
      status: 'error',
      message: 'Format QR Code tidak valid (harus mengandung field token & id_kelas).',
    };
  }

  const { id_kelas, token } = qrData;

  // Obtain valid API session (auto re-login if expired)
  let apiSession;
  try {
    apiSession = await getValidApiSession(sessionUser.nim);
  } catch (err) {
    return { status: 'error', message: err.message };
  }

  let cookies = {
    cookieSession: apiSession.cookie_session,
    cookieXsrf: apiSession.cookie_xsrf,
    cookieCfClearance: apiSession.cookie_cf_clearance,
  };
  let currentInertiaVersion = apiSession.inertia_version;

  let jadwalRes = await getJadwal({ ...cookies, inertiaVersion: currentInertiaVersion });

  // If unauthenticated or expired (e.g. 401 or redirected to login), force refresh session and retry once
  if (jadwalRes?.isError && (jadwalRes.status === 401 || jadwalRes.status === 302)) {
    console.log('[INFO] API session unauthenticated, forcing re-login to API...');
    try {
      apiSession = await getValidApiSession(sessionUser.nim, true);
      cookies = {
        cookieSession: apiSession.cookie_session,
        cookieXsrf: apiSession.cookie_xsrf,
        cookieCfClearance: apiSession.cookie_cf_clearance,
      };
      currentInertiaVersion = apiSession.inertia_version;
      jadwalRes = await getJadwal({ ...cookies, inertiaVersion: currentInertiaVersion });
    } catch (refreshErr) {
      return { status: 'error', message: refreshErr.message };
    }
  }

  if (jadwalRes?.isError && jadwalRes.status === 409) {
    console.log('[INFO] Got 409 conflict, refetching inertia version...');
    const newVersion = await fetchInertiaVersion();
    if (newVersion) {
      currentInertiaVersion = newVersion;
      jadwalRes = await getJadwal({ ...cookies, inertiaVersion: currentInertiaVersion });
    }
  }

  const jadwalList = (jadwalRes?.isError ? jadwalRes.data?.data?.data : jadwalRes?.data?.data) || [];

  if (!Array.isArray(jadwalList) || jadwalList.length === 0) {
    return { status: 'tidak_eligible', message: 'Tidak ada jadwal kuliah hari ini.' };
  }

  const eligible = jadwalList.filter((j) => j.presdsnStatus === 'in_progress');

  if (eligible.length === 0) {
    return { status: 'tidak_eligible', message: 'Belum ada sesi presensi yang dibuka oleh dosen.' };
  }

  const kelasFiltered = eligible.filter((j) => String(j.detdsnklsId) === String(id_kelas));

  if (kelasFiltered.length === 0) {
    return { status: 'tidak_eligible', message: 'Tidak ada sesi presensi yang sesuai dengan QR Code ini.' };
  }

  const belumAbsen = kelasFiltered.filter((j) => j.presmhsId === null);

  if (belumAbsen.length === 0) {
    return { status: 'sudah_presensi', message: 'Anda sudah presensi pada sesi kelas ini.' };
  }

  const results = [];
  for (const jadwal of belumAbsen) {
    const presensiRes = await submitPresensi({
      ...cookies,
      inertiaVersion: currentInertiaVersion,
      detdsnklsId: jadwal.detdsnklsId,
      id_kelas,
      token,
      latitude: config.defaultLatitude,
      longitude: config.defaultLongitude,
    });

    if (presensiRes.cloudflare) {
      return { status: 'gagal', message: 'Sistem presensi Polines terhadang Cloudflare challenge.' };
    }

    if (presensiRes.success) {
      results.push({ matkul: jadwal.mkkurNamaResmi, status: 'hadir' });
    } else {
      results.push({ matkul: jadwal.mkkurNamaResmi, status: 'gagal', detail: presensiRes.data?.message || 'Gagal submit presensi' });
    }
  }

  const hadirCount = results.filter((r) => r.status === 'hadir').length;
  const gagalCount = results.filter((r) => r.status === 'gagal').length;

  if (hadirCount > 0) {
    return {
      status: 'hadir',
      message: `Presensi Berhasil untuk ${hadirCount} mata kuliah!`,
      results,
    };
  } else if (gagalCount > 0) {
    return {
      status: 'gagal',
      message: `Presensi gagal. Detail: ${results[0]?.detail || ''}`,
      results,
    };
  }

  return { status: 'tidak_eligible', message: 'Tidak ada sesi yang dapat diproses.', results };
}
