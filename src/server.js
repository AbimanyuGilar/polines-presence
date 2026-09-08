import express from 'express';
import session from 'express-session';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import { login } from './api.js';
import { extractQrFromBuffer } from './qrDecoder.js';
import { processPresensiSession } from './presensiService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    cookie: { maxAge: 2 * 60 * 60 * 1000 } // 2 hours
  })
);

app.use(express.static(path.join(__dirname, '../public')));

// Middleware Auth check
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, message: 'Silakan login terlebih dahulu' });
  }
  next();
}

// Check auth status
app.get('/api/user', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ loggedIn: true, user: { nim: req.session.user.nim, nama: req.session.user.nama } });
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
    const authData = await login(nim, password);
    req.session.user = authData;

    res.json({
      success: true,
      message: 'Login berhasil',
      user: { nim: authData.nim, nama: authData.nama }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Logout API
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, message: 'Berhasil logout' });
  });
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

    const result = await processPresensiSession(req.session.user, qrString);
    res.json(result);
  } catch (err) {
    console.error('Error during presensi endpoint:', err);
    res.status(500).json({ status: 'error', message: `Terjadi kesalahan sistem: ${err.message}` });
  }
});

app.listen(config.port, () => {
  console.log(`Server Express Presensi Web berjalan di http://localhost:${config.port}`);
});
