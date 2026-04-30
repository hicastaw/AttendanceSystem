import pg from 'pg';

const pool = new pg.Pool({
  connectionString: 'postgresql://attendance_user:attendance_pass@localhost:5432/attendance_db'
});

async function main() {
  const res = await pool.query(`
    SELECT record_id, session_id, attendance_status, is_manual_override, note 
    FROM attendance_records 
    LIMIT 5
  `);
  console.log('Before update:', res.rows);

  if (res.rows.length > 0) {
    const recordId = res.rows[0].record_id;
    const sessionId = res.rows[0].session_id;

    // Run the actual update query from attendance.js
    const updateRes = await pool.query(`
      UPDATE attendance_records ar
      SET
        attendance_status = 'late',
        is_manual_override = TRUE,
        note = 'Test note',
        updated_at = CURRENT_TIMESTAMP
      FROM attendance_sessions s
      WHERE ar.record_id = $1
        AND ar.session_id = $2
        AND s.session_id = ar.session_id
      RETURNING ar.*
    `, [recordId, sessionId]);

    console.log('Update result:', updateRes.rows);
    
    // Check if it actually updated in the DB
    const checkRes = await pool.query(`
      SELECT record_id, attendance_status, is_manual_override, note 
      FROM attendance_records 
      WHERE record_id = $1
    `, [recordId]);
    console.log('After update:', checkRes.rows);
  }

  process.exit(0);
}
main();
