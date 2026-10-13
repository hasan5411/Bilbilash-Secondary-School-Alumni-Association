import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const [rows] = await conn.query(
  `SELECT u.user_id, u.email, u.status, p.present_address, p.permanent_address, p.address
     FROM users u JOIN profiles p ON p.user_id = u.user_id
    WHERE u.email = 'tmp.addrsplit@api.test'`
);
console.log(JSON.stringify(rows, null, 2));

await conn.end();
