import 'dotenv/config';

export default {
  baseUrl: process.env.BASE_URL || 'https://presensi.polines.ac.id',
  defaultLatitude: parseFloat(process.env.DEFAULT_LATITUDE || '-7.052547'),
  defaultLongitude: parseFloat(process.env.DEFAULT_LONGITUDE || '110.434410'),
  port: parseInt(process.env.PORT || '3000', 10),
  sessionSecret: process.env.SESSION_SECRET || 'polines-presensi-secret-key-12345',
};
