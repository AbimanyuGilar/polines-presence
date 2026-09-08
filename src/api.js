import axios from 'axios';
import config from './config.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const client = axios.create({
  baseURL: config.baseUrl,
  maxRedirects: 5,
  timeout: 30000,
});

export function decodeXsrfToken(cookieValue) {
  if (!cookieValue) return '';
  return decodeURIComponent(cookieValue);
}

function buildCookieString({ cookieSession, cookieXsrf, cookieCfClearance }) {
  const parts = [];
  if (cookieCfClearance) parts.push(`cf_clearance=${cookieCfClearance}`);
  if (cookieXsrf) parts.push(`XSRF-TOKEN=${cookieXsrf}`);
  if (cookieSession) parts.push(`presensi_session=${cookieSession}`);
  return parts.join('; ');
}

function parseSetCookieHeaders(setCookieArray) {
  const cookies = {};
  if (!setCookieArray) return cookies;
  const arr = Array.isArray(setCookieArray) ? setCookieArray : [setCookieArray];
  for (const entry of arr) {
    const match = entry.match(/^([^=]+)=([^;]+)/);
    if (match) {
      cookies[match[1]] = match[2];
    }
  }
  return cookies;
}

export async function fetchInertiaVersion() {
  try {
    const res = await client.get('/', {
      headers: { 'User-Agent': USER_AGENT },
    });

    const headerVersion = res.headers['x-inertia-version'];
    if (headerVersion) return headerVersion;

    const html = typeof res.data === 'string' ? res.data : '';
    const match = html.match(/data-page=["']({.*?})["']/);
    if (match) {
      try {
        const pageData = JSON.parse(match[1].replace(/&quot;/g, '"'));
        if (pageData.version) return pageData.version;
      } catch {}
    }

    return null;
  } catch (err) {
    console.error('api.fetchInertiaVersion error:', err.message);
    return null;
  }
}

export async function login(nim, password) {
  try {
    const csrfRes = await axios.get(`${config.baseUrl}/sanctum/csrf-cookie`, {
      headers: { 'User-Agent': USER_AGENT },
      maxRedirects: 0,
      validateStatus: () => true,
    });

    const cookies = parseSetCookieHeaders(csrfRes.headers['set-cookie']);
    const rawXsrf = cookies['XSRF-TOKEN'] || '';
    const xsrfToken = decodeXsrfToken(rawXsrf);
    const cookieStr = buildCookieString({
      cookieSession: cookies['presensi_session'],
      cookieXsrf: cookies['XSRF-TOKEN'],
      cookieCfClearance: cookies['cf_clearance'],
    });

    const loginRes = await axios.post(`${config.baseUrl}/login`, {
      email: nim,
      password,
      remember: true,
    }, {
      maxRedirects: 0,
      validateStatus: () => true,
      headers: {
        'Cookie': cookieStr,
        'X-XSRF-TOKEN': xsrfToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': USER_AGENT,
        'Referer': `${config.baseUrl}/login`,
        'Origin': config.baseUrl,
      },
    });

    const location = loginRes.headers['location'] || '';
    if (loginRes.status === 422) {
      throw new Error('NIM atau password salah');
    }
    if (loginRes.status === 302 && location.includes('/login')) {
      throw new Error('NIM atau password salah');
    }

    const loginCookies = parseSetCookieHeaders(loginRes.headers['set-cookie']);
    Object.assign(cookies, loginCookies);

    const dashCookieStr = buildCookieString({
      cookieSession: cookies['presensi_session'],
      cookieXsrf: cookies['XSRF-TOKEN'],
      cookieCfClearance: cookies['cf_clearance'],
    });

    const dashRes = await axios.get(`${config.baseUrl}/dashboard`, {
      headers: {
        'Cookie': dashCookieStr,
        'User-Agent': USER_AGENT,
        'Accept': 'text/html',
      },
    });

    let inertiaVersion = null;
    let studentName = nim;
    const dashHtml = typeof dashRes.data === 'string' ? dashRes.data : '';
    const dashMatch = dashHtml.match(/data-page=["']({.*?})["']/);
    if (dashMatch) {
      try {
        const pageData = JSON.parse(dashMatch[1].replace(/&quot;/g, '"'));
        inertiaVersion = pageData.version || null;
        if (pageData.props?.auth?.user?.name) {
          studentName = pageData.props.auth.user.name;
        }
      } catch {}
    }

    const expiredAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

    return {
      nim,
      nama: studentName,
      cookie_session: cookies['presensi_session'] || null,
      cookie_xsrf: cookies['XSRF-TOKEN'] || null,
      cookie_cf_clearance: cookies['cf_clearance'] || null,
      inertia_version: inertiaVersion,
      cookie_expires_at: expiredAt.toISOString(),
    };
  } catch (err) {
    console.error('api.login error:', err.message);
    throw new Error(`Login gagal: ${err.message}`);
  }
}

export async function getJadwal({ cookieSession, cookieXsrf, cookieCfClearance, inertiaVersion }) {
  try {
    const cookie = buildCookieString({ cookieSession, cookieXsrf, cookieCfClearance });
    const res = await client.get('/mahasiswa/table-jadwal', {
      params: { page: 1, per_page: 100, jenis: 'today' },
      headers: {
        Cookie: cookie,
        'X-Inertia': 'true',
        'X-Inertia-Version': inertiaVersion || '',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });
    return res.data;
  } catch (err) {
    console.error('api.getJadwal error:', err.message);
    if (err.response) return { isError: true, status: err.response.status, data: err.response.data };
    throw err;
  }
}

export async function submitPresensi({ cookieSession, cookieXsrf, cookieCfClearance, inertiaVersion, detdsnklsId, id_kelas, token, latitude, longitude }) {
  try {
    const cookie = buildCookieString({ cookieSession, cookieXsrf, cookieCfClearance });
    const xsrfToken = decodeXsrfToken(cookieXsrf);

    const res = await client.post(
      '/mahasiswa/presensi',
      {
        detdsnklsId,
        id_kelas,
        latitude,
        longitude,
        token,
      },
      {
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          'X-Inertia': 'true',
          'X-Inertia-Version': inertiaVersion || '',
          'X-XSRF-TOKEN': xsrfToken,
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json',
          Referer: `${config.baseUrl}/mahasiswa/jadwal`,
          Origin: config.baseUrl,
          'User-Agent': USER_AGENT,
        },
      }
    );

    return { success: true, status: res.status, data: res.data };
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const contentType = err.response.headers?.['content-type'] || '';

      if (status === 403 && contentType.includes('text/html')) {
        return { success: false, status: 403, cloudflare: true };
      }

      return { success: false, status, data: err.response.data };
    }

    console.error('api.submitPresensi network error:', err.message);
    return { success: false, status: 0, data: err.message };
  }
}
