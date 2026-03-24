const { v4: uuidv4 } = require('uuid');
const { getDb, initDb } = require('./database');
const { hashPin } = require('../utils/auth');

const SERVICE_INTERVALS = {
  'Oil Change': { kms: 10000, days: 180 },
  'Tyre Rotation': { kms: 10000, days: 180 },
  'Brake Pads': { kms: 30000, days: 730 },
  'Air Filter': { kms: 20000, days: 365 },
  'Coolant Flush': { kms: 40000, days: 730 },
  'Transmission Service': { kms: 60000, days: 1095 },
  'Battery Check': { kms: 20000, days: 365 },
  'Chain Lube': { kms: 1000, days: 30 },
  'Spark Plugs': { kms: 30000, days: 730 },
  'General Service': { kms: 15000, days: 365 },
};

const DEFAULT_CATEGORIES = [
  'Oil Change',
  'Tyre Rotation',
  'Brake Pads',
  'Air Filter',
  'Coolant Flush',
  'Transmission Service',
  'Battery Check',
  'Chain Lube',
  'Spark Plugs',
  'General Service',
];

const SEED_VEHICLES = [
  { name: 'Tesla Model 3', make: 'Tesla', model: 'Model 3', year: null, type: 'car' },
  { name: 'Tesla Model Y', make: 'Tesla', model: 'Model Y', year: null, type: 'car' },
  { name: 'Infiniti JX35 2013', make: 'Infiniti', model: 'JX35', year: 2013, type: 'car' },
  { name: 'VW Golf GTI (EU ROW) 2018', make: 'Volkswagen', model: 'Golf GTI', year: 2018, type: 'car' },
  {
    name: 'Lincoln Mark V Golden Jubilee 1978',
    make: 'Lincoln',
    model: 'Mark V Golden Jubilee',
    year: 1978,
    type: 'car',
    notes: 'Blue, 460 engine',
  },
  { name: 'GWM Tank 700 Petrol', make: 'GWM', model: 'Tank 700', year: null, type: 'car' },
  { name: 'Yamaha FJR 1300 Gen 2 2011', make: 'Yamaha', model: 'FJR 1300', year: 2011, type: 'motorcycle' },
  { name: 'BMW R1300GS Triple Black 2025', make: 'BMW', model: 'R1300GS Triple Black', year: 2025, type: 'motorcycle' },
  { name: 'Yamaha MT-07 2023', make: 'Yamaha', model: 'MT-07', year: 2023, type: 'motorcycle' },
  { name: 'Suzuki Hayabusa 2022', make: 'Suzuki', model: 'Hayabusa', year: 2022, type: 'motorcycle' },
];

async function seed() {
  const db = getDb();

  // Seed categories if empty
  const categoryCount = await db.get('SELECT COUNT(*) as count FROM categories');
  if (Number(categoryCount.count) === 0) {
    for (const name of DEFAULT_CATEGORIES) {
      const interval = SERVICE_INTERVALS[name] || {};
      await db.run(
        'INSERT INTO categories (id, name, "isDefault", "isArchived", "defaultKms", "defaultDays") VALUES (?, ?, 1, 0, ?, ?)',
        uuidv4(),
        name,
        interval.kms || null,
        interval.days || null
      );
    }
    console.log(`Seeded ${DEFAULT_CATEGORIES.length} default categories.`);
  } else {
    // Backfill defaultKms/defaultDays on existing categories if missing
    for (const name of DEFAULT_CATEGORIES) {
      const interval = SERVICE_INTERVALS[name];
      if (interval) {
        await db.run(
          'UPDATE categories SET "defaultKms" = COALESCE("defaultKms", ?), "defaultDays" = COALESCE("defaultDays", ?) WHERE LOWER(name) = LOWER(?)',
          interval.kms,
          interval.days,
          name
        );
      }
    }
    console.log('Categories table already has data, backfilled default intervals.');
  }

  // Seed vehicles if empty
  const vehicleCount = await db.get('SELECT COUNT(*) as count FROM vehicles');
  if (Number(vehicleCount.count) === 0) {
    for (const v of SEED_VEHICLES) {
      await db.run(
        `INSERT INTO vehicles (id, name, make, model, year, type, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        uuidv4(),
        v.name,
        v.make,
        v.model,
        v.year,
        v.type,
        v.notes || null
      );
    }
    console.log(`Seeded ${SEED_VEHICLES.length} vehicles.`);
  } else {
    console.log('Vehicles table already has data, skipping seed.');
  }

  // Seed settings if empty
  const settingsCount = await db.get('SELECT COUNT(*) as count FROM settings');
  if (Number(settingsCount.count) === 0) {
    await db.run(
      `INSERT INTO settings (id, currency, timezone, emails, "whatsappNumber", "reminderBufferKms", "reminderBufferDays")
       VALUES (1, 'AED', 'Asia/Dubai', '[]', NULL, 500, 7)`
    );
    console.log('Seeded default settings.');
  } else {
    console.log('Settings table already has data, skipping seed.');
  }

  // Seed users if empty
  const userCount = await db.get('SELECT COUNT(*) as count FROM users');
  if (Number(userCount.count) === 0) {
    await db.run(
      'INSERT INTO users (id, name, "pinHash", role, "isActive") VALUES (?, ?, ?, ?, 1)',
      uuidv4(),
      'Hameed',
      hashPin('1234'),
      'admin'
    );
    await db.run(
      'INSERT INTO users (id, name, "pinHash", role, "isActive") VALUES (?, ?, ?, ?, 1)',
      uuidv4(),
      'Driver',
      hashPin('0000'),
      'driver'
    );
    console.log('Seeded 2 default users (Hameed: admin/1234, Driver: driver/0000).');
  } else {
    console.log('Users table already has data, skipping seed.');
  }
}

// Allow running directly: node db/seed.js
if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  initDb()
    .then(() => seed())
    .then(() => {
      console.log('Seed complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

module.exports = { seed, SERVICE_INTERVALS };
