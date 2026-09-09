import express from 'express';
import session from 'express-session';
import multer from 'multer';
import config from '../src/config.js';
import { loginUser } from '../src/authService.js';
import { extractQrFromBuffer } from '../src/qrDecoder.js';
import { processPresensiSession } from '../src/presensiService.js';
import { createAuthToken, verifyAuthToken, parseCookies } from '../src/cryptoUtils.js';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    }
  })
);

function getAuthUser(req) {
  if (req.session && req.session.user) {
    return req.session.user;
  }
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['app_user_token'];
  if (token) {
    const verified = verifyAuthToken(token);
    if (verified && verified.nim) {
      if (req.session) req.session.user = verified;
      return verified;
    }
  }
  return null;
}

// Middleware Auth check
function requireAuth(req, res, next) {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Silakan login terlebih dahulu' });
  }
  req.authUser = user;
  next();
}

// Check auth status
app.get('/api/user', (req, res) => {
  const user = getAuthUser(req);
  if (user) {
    return res.json({ loggedIn: true, user: { nim: user.nim, nama: user.nama } });
  }
  res.json({ loggedIn: false });
});

// Login API
app.post('/api/login', async (req, res) => {
  const { nim, password } = req.body;

  if (!nim || !password) {
    return res.status(400).json({ success: false, message: 'NIM dan Password harus diisi.' });
  }

  try {
    const authData = await loginUser(nim, password);
    const userObj = { nim: authData.nim, nama: authData.nama };

    if (req.session) req.session.user = userObj;

    const token = createAuthToken(userObj);
    const isProd = process.env.NODE_ENV === 'production';
    res.setHeader(
      'Set-Cookie',
      `app_user_token=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${isProd ? '; Secure' : ''}`
    );

    res.json({
      success: true,
      message: 'Login berhasil',
      user: userObj
    });
  } catch (err) {
    console.error('Error during /api/login:', err);
    res.status(400).json({ success: false, message: err.message || 'Login gagal' });
  }
});

// Logout API
app.post('/api/logout', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  res.setHeader(
    'Set-Cookie',
    `app_user_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${isProd ? '; Secure' : ''}`
  );

  if (req.session) {
    req.session.destroy(() => {
      res.json({ success: true, message: 'Berhasil logout' });
    });
  } else {
    res.json({ success: true, message: 'Berhasil logout' });
  }
});

// Presensi upload QR API
app.post('/api/presensi', requireAuth, upload.single('qrImage'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'Tidak ada file QR Code yang diupload' });
  }

  try {
    const qrString = await extractQrFromBuffer(req.file.buffer);

    if (!qrString) {
      return res.status(400).json({
        status: 'error',
        message: 'Tidak dapat membaca QR Code dari gambar yang diupload. Pastikan gambar QR Code jelas dan terang.'
      });
    }

    const user = req.authUser || getAuthUser(req);
    const result = await processPresensiSession(user, qrString);
    res.json(result);
  } catch (err) {
    console.error('Error during presensi endpoint:', err);
    res.status(500).json({ status: 'error', message: `Terjadi kesalahan sistem: ${err.message}` });
  }
});

export default app;
