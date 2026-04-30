
async function testApi() {
  try {
    // 1. Get token
    const loginData = JSON.stringify({ identifier: 'admin', password: 'admin123' });
    
    // Using simple fetch via node
    const loginRes = await fetch('http://localhost:3001/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: loginData
    });
    const loginJson = await loginRes.json();
    console.log('Login:', loginJson);
    
    if (!loginJson.data || !loginJson.data.accessToken) {
      console.log('Login failed');
      return;
    }
    const token = loginJson.data.accessToken;

    // 2. Fetch records for session 1
    const recordsRes = await fetch('http://localhost:3001/api/v1/attendance/sessions/1/records', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const recordsJson = await recordsRes.json();
    console.log('Records count:', recordsJson.data?.length);

    if (recordsJson.data?.length > 0) {
      const record = recordsJson.data[0];
      console.log('Before update:', record.student_name, record.attendance_status);

      // 3. Update manual override
      const putRes = await fetch(`http://localhost:3001/api/v1/attendance/sessions/1/records/${record.record_id}/manual-override`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          attendance_status: 'late',
          note: 'Tested from script'
        })
      });
      const putJson = await putRes.json();
      console.log('Put response:', putJson);

      // 4. Fetch records again
      const recordsRes2 = await fetch('http://localhost:3001/api/v1/attendance/sessions/1/records', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const recordsJson2 = await recordsRes2.json();
      const record2 = recordsJson2.data.find(r => r.record_id === record.record_id);
      console.log('After update:', record2?.student_name, record2?.attendance_status);
    }
  } catch (err) {
    console.error(err);
  }
}

testApi();
