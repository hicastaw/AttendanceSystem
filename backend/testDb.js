import pg from 'pg';

const pool = new pg.Pool({
  connectionString: 'postgresql://attendance_user:attendance_pass@localhost:5432/attendance_db'
});

async function main() {
  try {
    // 1. Get a record to update
    const res = await pool.query(`
      SELECT record_id, session_id, attendance_status, is_manual_override 
      FROM vw_attendance_session_detail 
      LIMIT 1
    `);
    if (res.rows.length === 0) {
      console.log('No records found');
      process.exit(0);
    }
    
    const record = res.rows[0];
    console.log('Before update:', record);

    // 2. Run the update query EXACTLY as in attendance.js
    const updateRes = await pool.query(`
      UPDATE attendance_records ar
      SET
        attendance_status = $1,
        recognition_status = $2,
        is_manual_override = TRUE,
        note = $3,
        checkin_time = CASE
          WHEN $4::timestamp IS NOT NULL THEN $4::timestamp
          WHEN $1 = 'absent' THEN NULL
          ELSE COALESCE(ar.checkin_time, CURRENT_TIMESTAMP)
        END,
        updated_at = CURRENT_TIMESTAMP
      FROM attendance_sessions s
      WHERE ar.record_id = $5
        AND ar.session_id = $6
        AND s.session_id = ar.session_id
      RETURNING ar.*
    `, [
      'early',
      'manual_marked',
      'Test script note',
      null,
      record.record_id,
      record.session_id
    ]);

    console.log('Update result rows:', updateRes.rows.length);
    if (updateRes.rows.length > 0) {
      console.log('Update result data:', updateRes.rows[0].attendance_status, updateRes.rows[0].is_manual_override);
    }

    // 3. Query the view again
    const viewRes = await pool.query(`
      SELECT record_id, attendance_status, is_manual_override 
      FROM vw_attendance_session_detail 
      WHERE record_id = $1
    `, [record.record_id]);
    
    console.log('After update view:', viewRes.rows[0]);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

main();
