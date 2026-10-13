import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const [del] = await conn.query(
  `DELETE FROM users WHERE email = 'tmp.addrsplit@api.test'`
);
console.log('deleted temp users:', del.affectedStatus ?? del.affectedRows);

const [users] = await conn.query(`SELECT user_id, email, status FROM users ORDER BY user_id`);
console.log('remaining users:', JSON.stringify(users.map(u => `${u.user_id}:${u.email}:${u.status}`)));

await conn.end();
