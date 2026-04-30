import pg from 'pg';

const pool = new pg.Pool({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/attendance_db'
});

async function main() {
  const res = await pool.query(`
    SELECT record_id, attendance_status, is_manual_override, note 
    FROM attendance_records 
    LIMIT 5
  `);
  console.log('Before update:', res.rows);

  if (res.rows.length > 0) {
    const recordId = res.rows[0].record_id;
    const sessionId = 1; // Need to know session_id

    // Just run the same update query to see if it works
    const updateRes = await pool.query(`
      UPDATE attendance_records ar
      SET
        attendance_status = 'late',
        is_manual_override = TRUE,
        note = 'Test note',
        updated_at = CURRENT_TIMESTAMP
      FROM attendance_sessions s
      WHERE ar.record_id = $1
      RETURNING ar.*
    `, [recordId]);

    console.log('Update result:', updateRes.rows);
  }

  process.exit(0);
}
main();
