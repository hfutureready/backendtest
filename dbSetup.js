// dbSetup.js
const { Pool } = require("pg");
require("dotenv").config();

async function initDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log("🛠️ Initializing database schema...");

    // Create tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        email VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        dob DATE NOT NULL,
        age INTEGER NOT NULL,
        healthRecords TEXT[] NOT NULL,
        reportsCount INTEGER DEFAULT 0,
        scansCount INTEGER DEFAULT 0,
        queriesCount INTEGER DEFAULT 0
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS activities (
        id SERIAL PRIMARY KEY,
        userEmail VARCHAR(255) REFERENCES users(email) ON DELETE CASCADE,
        action VARCHAR(255) NOT NULL,
        date TIMESTAMP NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS session (
        sid VARCHAR PRIMARY KEY,
        sess JSONB NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      );
    `);

    console.log("✅ Tables created successfully");

    // Check if any users exist
    const result = await pool.query(`SELECT COUNT(*) FROM users`);
    const count = parseInt(result.rows[0].count, 10);

    if (count === 0) {
      // Insert dummy admin user if no user exists
      await pool.query(
        `INSERT INTO users (email, name, dob, age, healthRecords) 
         VALUES ($1, $2, $3, $4, $5)`,
        [
          "admin@example.com",
          "Admin",
          "1990-01-01",
          35,
          ["Initial health record"]
        ]
      );
      console.log("👤 Dummy admin user created.");
    } else {
      console.log("ℹ️ Users already exist. No dummy user inserted.");
    }

    // Fetch all data from the database
    console.log("📊 Fetching all data...");

    // Fetch all users
    const users = await pool.query("SELECT * FROM users");
    console.log("🧑‍💻 Users:", users.rows);

    // Fetch all activities
    const activities = await pool.query("SELECT * FROM activities");
    console.log("📝 Activities:", activities.rows);


    // Fetch all session data
    const sessions = await pool.query("SELECT * FROM session");
    console.log("📅 Sessions:", sessions.rows);

// Loop through the sessions to print the cookie
    sessions.rows.forEach(session => {
        console.log("🧑‍💻 Session ID:", session.sid);
    console.log("📄 Cookie:", session.sess.cookie);  // Print the cookie object for each session
    });

  } catch (err) {
    console.error("❌ Error initializing database:", err.message);
    throw err;
  } finally {
    await pool.end();
  }
}

module.exports = { initDatabase };

// Run directly
if (require.main === module) {
  initDatabase()
    .then(() => console.log("✨ Setup complete."))
    .catch(err => console.error("💥 Setup failed:", err));
}
