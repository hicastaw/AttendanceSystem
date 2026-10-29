// Additive candidate storage, installed ONLY in a guarded CPU test database.
// Legacy face_profiles and capture_receipts are never relabeled or overwritten.
export function migrateVersionedGallery(db,contracts) {
  db.transaction(()=>{
    db.exec(`CREATE TABLE IF NOT EXISTS candidate_contracts (
      contract_id TEXT PRIMARY KEY, contract_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS candidate_profiles (
      user_id INTEGER NOT NULL REFERENCES users(user_id), contract_id TEXT NOT NULL REFERENCES candidate_contracts(contract_id),
      embedding TEXT NOT NULL, PRIMARY KEY(user_id,contract_id));
      CREATE TABLE IF NOT EXISTS candidate_capture_receipts (
      session_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(user_id),
      contract_id TEXT NOT NULL REFERENCES candidate_contracts(contract_id));`);
    for(const contract of contracts.values()) {
      const old=db.prepare('SELECT contract_json FROM candidate_contracts WHERE contract_id=?').get(contract.contract_id);
      const json=JSON.stringify(contract);
      if(old && old.contract_json!==json)throw new Error('Provisioned contract mutation forbidden');
      db.prepare('INSERT OR IGNORE INTO candidate_contracts VALUES (?,?)').run(contract.contract_id,json);
    }
  })();
}

export function saveCandidate(db,{userId,contractId,sessionId,embedding}) {
  return db.transaction(()=>{
    const receipt=db.prepare('SELECT * FROM candidate_capture_receipts WHERE session_id=?').get(sessionId);
    if(receipt) {
      if(receipt.user_id!==userId || receipt.contract_id!==contractId)throw new Error('Capture receipt binding mismatch');
      return false;
    }
    if(!db.prepare("SELECT 1 FROM users WHERE user_id=? AND status='active'").get(userId))throw new Error('Member no longer active');
    db.prepare(`INSERT INTO candidate_profiles VALUES (?,?,?) ON CONFLICT(user_id,contract_id)
      DO UPDATE SET embedding=excluded.embedding`).run(userId,contractId,JSON.stringify(embedding));
    db.prepare('INSERT INTO candidate_capture_receipts VALUES (?,?,?)').run(sessionId,userId,contractId);
    return true;
  })();
}

export function candidateGallery(db,contractId) {
  return db.prepare(`SELECT u.user_code,u.full_name,p.embedding FROM candidate_profiles p JOIN users u USING(user_id)
    WHERE p.contract_id=? AND u.status='active' ORDER BY u.user_code`).all(contractId)
    .map(row=>({...row,embedding:JSON.parse(row.embedding)}));
}
