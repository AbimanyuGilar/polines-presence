import { prisma } from './db.js';
import { login } from './api.js';
import { encryptPassword, decryptPassword } from './cryptoUtils.js';

/**
 * Handle user login to local Web app and Polines API.
 */
export async function loginUser(nim, password) {
  let existingUser = null;
  try {
    existingUser = await prisma.user.findUnique({ where: { nim } });
  } catch (err) {
    console.error('Prisma fetch error (proceeding to API login):', err.message);
  }

  // If user exists locally, verify local password first
  if (existingUser && existingUser.passwordEncrypted) {
    const decrypted = decryptPassword(existingUser.passwordEncrypted);
    if (decrypted && decrypted !== password) {
      throw new Error('NIM atau Password salah');
    }
  }

  // Login to API Polines to get fresh tokens
  const authData = await login(nim, password);

  const encPassword = encryptPassword(password);

  let updatedUser;
  try {
    updatedUser = await prisma.user.upsert({
      where: { nim },
      update: {
        nama: authData.nama,
        passwordEncrypted: encPassword,
        cookieSession: authData.cookie_session,
        cookieXsrf: authData.cookie_xsrf,
        cookieCfClearance: authData.cookie_cf_clearance,
        inertiaVersion: authData.inertia_version,
        cookieExpiresAt: new Date(authData.cookie_expires_at),
      },
      create: {
        nim: authData.nim,
        nama: authData.nama,
        passwordEncrypted: encPassword,
        cookieSession: authData.cookie_session,
        cookieXsrf: authData.cookie_xsrf,
        cookieCfClearance: authData.cookie_cf_clearance,
        inertiaVersion: authData.inertia_version,
        cookieExpiresAt: new Date(authData.cookie_expires_at),
      },
    });
  } catch (dbErr) {
    console.error('Failed to save user to database:', dbErr.message);
    // Fallback to returned authData if DB query fails
    return authData;
  }

  return {
    nim: updatedUser.nim,
    nama: updatedUser.nama,
    cookie_session: updatedUser.cookieSession,
    cookie_xsrf: updatedUser.cookieXsrf,
    cookie_cf_clearance: updatedUser.cookieCfClearance,
    inertia_version: updatedUser.inertiaVersion,
    cookie_expires_at: updatedUser.cookieExpiresAt?.toISOString(),
  };
}

/**
 * Ensures a valid Polines API session for the user.
 * If API session is expired or invalid, auto re-logins to Polines API using saved credentials in DB.
 */
export async function getValidApiSession(nim, forceRefresh = false) {
  let user = null;
  try {
    user = await prisma.user.findUnique({ where: { nim } });
  } catch (err) {
    console.error('Error reading user from DB for API session:', err.message);
  }

  const now = new Date();
  const isExpired = !user?.cookieExpiresAt || new Date(user.cookieExpiresAt) <= now;

  if (!user || isExpired || forceRefresh) {
    if (!user || !user.passwordEncrypted) {
      throw new Error('Sesi API berakhir dan kredensial tersimpan tidak ditemukan. Silakan login kembali.');
    }

    console.log(`[AUTH] Session API expired or invalid for NIM ${nim}. Auto re-logging in to Polines API...`);
    const plainPassword = decryptPassword(user.passwordEncrypted);
    
    if (!plainPassword) {
      throw new Error('Gagal mendekripsi kredensial tersimpan. Silakan login kembali.');
    }

    const authData = await login(nim, plainPassword);

    try {
      user = await prisma.user.update({
        where: { nim },
        data: {
          nama: authData.nama,
          cookieSession: authData.cookie_session,
          cookieXsrf: authData.cookie_xsrf,
          cookieCfClearance: authData.cookie_cf_clearance,
          inertiaVersion: authData.inertia_version,
          cookieExpiresAt: new Date(authData.cookie_expires_at),
        },
      });
    } catch (dbErr) {
      console.error('Error updating refreshed session in DB:', dbErr.message);
      return {
        nim,
        nama: authData.nama,
        cookie_session: authData.cookie_session,
        cookie_xsrf: authData.cookie_xsrf,
        cookie_cf_clearance: authData.cookie_cf_clearance,
        inertia_version: authData.inertia_version,
        cookie_expires_at: authData.cookie_expires_at,
      };
    }
  }

  return {
    nim: user.nim,
    nama: user.nama,
    cookie_session: user.cookieSession,
    cookie_xsrf: user.cookieXsrf,
    cookie_cf_clearance: user.cookieCfClearance,
    inertia_version: user.inertiaVersion,
    cookie_expires_at: user.cookieExpiresAt?.toISOString(),
  };
}
